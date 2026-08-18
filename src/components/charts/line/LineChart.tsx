import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { Canvas, DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'

import { BandsLayer } from '@/components/charts/line/BandsLayer'
import { AXIS_FONT_SIZE, computeChartRow } from '@/components/charts/line/chartLayout'
import { formatAxisNumber } from '@/components/charts/line/chartFormat'
import { projectY } from '@/components/charts/line/projection'
import { useChartStack } from '@/components/charts/line/ChartStackContext'
import { GapMarkersLayer } from '@/components/charts/line/GapMarkersLayer'
import { ScrubCursor, ScrubLayer } from '@/components/charts/line/ScrubLayer'
import { SelectionLayer } from '@/components/charts/line/SelectionLayer'
import { SeriesLayer } from '@/components/charts/line/SeriesLayer'
import { toScrubTargets, type PreparedChart } from '@/components/charts/line/stackData'
import type { ChartPlotBox, ChartYRange } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'
import { textAdvanceWidth } from '../../../helpers/skiaText'

const GRID_COLOR = theme.palette.slate.surface
const AXIS_TEXT_COLOR = theme.palette.slate.textDim
const THRESHOLD_COLOR = theme.alpha(theme.palette.yellow.color, 0.12)

export interface LineChartProps {
  chart: PreparedChart
  /** Width of the stack, gutters included. */
  width: number
  /** This chart's position in the stack readout. */
  index: number
}

/**
 * One chart of a stack, in its own canvas.
 *
 * The canvas is the unit of redrawing: Skia re-records a picture on every React commit and lands
 * it a frame or two late, so anything sharing a canvas shares that lag. Giving each chart its own
 * means a chart's geometry never depends on its neighbours — opening or closing one is a React
 * Native layout change and every other chart's picture is left exactly as it was.
 *
 * What makes the stack a stack lives in {@link useChartStack}: one camera, one scrub head, one
 * readout, all read on the UI thread.
 */
export function LineChart({ chart, width, index }: LineChartProps) {
  const {
    camera,
    dataKey,
    domainStartMs,
    domainEndMs,
    scrubTimeMs,
    selection,
    readout,
    timeline,
    stackBands,
    labelFont,
    axisFont,
    scrubFont,
    showHead,
  } = useChartStack()

  const { plot, labelBaseline, canvasHeight } = useMemo(
    () => computeChartRow({ width, height: chart.height }),
    [chart.height, width],
  )
  const clip = useMemo(
    () => ({ x: plot.x, y: plot.y, width: plot.width, height: plot.height }),
    [plot],
  )
  const scrubTargets = useMemo(() => toScrubTargets(chart), [chart])
  const plotTransform = useMemo(
    () => [{ translateX: plot.x }, { translateY: plot.y }],
    [plot.x, plot.y],
  )

  return (
    <Canvas style={[styles.canvas, { height: canvasHeight }]}>
      {/* Before the plot: the cursor marks a moment, so it belongs behind the readings it
          points at rather than cutting across them. */}
      <ScrubCursor
        camera={camera}
        dataKey={dataKey}
        domainStartMs={domainStartMs}
        domainEndMs={domainEndMs}
        plotX={plot.x}
        plotWidth={plot.width}
        top={plot.y}
        bottom={plot.y + plot.height}
        scrubTimeMs={scrubTimeMs}
        timeline={timeline}
      />

      {labelFont && chart.label && (
        <Text
          font={labelFont}
          x={plot.x}
          y={labelBaseline}
          text={chart.label}
          color={theme.palette.slate.textSecondary}
        />
      )}

      <Group transform={plotTransform}>
        <Line p1={vec(0, 0.5)} p2={vec(plot.width, 0.5)} color={GRID_COLOR} strokeWidth={0.5} />
        <Line
          p1={vec(0, plot.height / 2)}
          p2={vec(plot.width, plot.height / 2)}
          color={GRID_COLOR}
          strokeWidth={0.5}
        >
          <DashPathEffect intervals={[4, 4]} />
        </Line>
        <Line
          p1={vec(0, plot.height - 0.5)}
          p2={vec(plot.width, plot.height - 0.5)}
          color={GRID_COLOR}
          strokeWidth={0.5}
        />
        {/* Thresholds are read against the value axis alone, so they need no camera: panning
            moves the line under them, never them. */}
        {chart.thresholds?.map((value) => (
          <Line
            key={value}
            p1={vec(0, projectY(value, chart.left.range, plot.height))}
            p2={vec(plot.width, projectY(value, chart.left.range, plot.height))}
            color={THRESHOLD_COLOR}
            strokeWidth={1}
          />
        ))}
      </Group>

      <Group clip={clip}>
        <Group transform={plotTransform}>
          {/* Ranges belonging to the ride, drawn through every chart at the same x. */}
          {stackBands && stackBands.length > 0 && (
            <BandsLayer
              bands={stackBands}
              plot={plot}
              camera={camera}
              dataKey={dataKey}
              domainStartMs={domainStartMs}
              domainEndMs={domainEndMs}
            />
          )}
          {/* Under the series: a band is context for the line, never something drawn over it. */}
          {chart.bands && chart.bands.length > 0 && (
            <BandsLayer
              bands={chart.bands}
              plot={plot}
              camera={camera}
              dataKey={dataKey}
              domainStartMs={domainStartMs}
              domainEndMs={domainEndMs}
            />
          )}
          {chart.series.map((series) => (
            <SeriesLayer
              key={series.key}
              paths={series.paths}
              color={series.color}
              ramp={series.ramp}
              showHead={showHead}
              yRange={
                (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range
              }
              plot={plot}
              camera={camera}
              dataKey={dataKey}
            />
          ))}
        </Group>
      </Group>

      {scrubFont && (
        <ScrubLayer
          targets={scrubTargets}
          plot={plot}
          index={index}
          readout={readout}
          font={scrubFont}
        />
      )}

      {axisFont && <AxisTicks font={axisFont} plot={plot} range={chart.left.range} side="left" />}
      {axisFont && chart.right && (
        <AxisTicks font={axisFont} plot={plot} range={chart.right.range} side="right" />
      )}

      {/* Over the plot: what is outside the selection is dimmed, lines included. */}
      {selection && (
        <SelectionLayer
          selection={selection}
          camera={camera}
          dataKey={dataKey}
          domainStartMs={domainStartMs}
          domainEndMs={domainEndMs}
          plotX={plot.x}
          plotWidth={plot.width}
          top={plot.y}
          bottom={plot.y + plot.height}
          timeline={timeline}
        />
      )}

      {axisFont && (
        <GapMarkersLayer
          variant="seam"
          timeline={timeline}
          camera={camera}
          dataKey={dataKey}
          domainStartMs={domainStartMs}
          domainEndMs={domainEndMs}
          plotX={plot.x}
          plotWidth={plot.width}
          top={plot.y}
          bottom={plot.y + plot.height}
          font={axisFont}
        />
      )}
    </Canvas>
  )
}

interface AxisTicksProps {
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
  plot: ChartPlotBox
  range: ChartYRange
  side: 'left' | 'right'
}

/** Three ticks — top, middle, bottom — matching the three grid lines of the plot. */
function AxisTicks({ font, plot, range, side }: AxisTicksProps) {
  const ticks = useMemo(() => {
    const values = [range.max, (range.min + range.max) / 2, range.min]
    const baselines = [
      plot.y + AXIS_FONT_SIZE,
      plot.y + plot.height / 2 + AXIS_FONT_SIZE / 2,
      plot.y + plot.height,
    ]
    return values.map((value, index) => {
      const text = formatAxisNumber(value)
      const x =
        side === 'left' ? plot.x - 4 - textAdvanceWidth(font, text) : plot.x + plot.width + 4
      return { text, x, y: baselines[index] }
    })
  }, [font, plot, range, side])

  return (
    <>
      {ticks.map((tick, index) => (
        <Text
          key={`${side}-${index}`}
          font={font}
          x={tick.x}
          y={tick.y}
          text={tick.text}
          color={AXIS_TEXT_COLOR}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  canvas: { width: '100%' },
})
