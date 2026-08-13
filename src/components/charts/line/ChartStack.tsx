import { useCallback, useMemo, useState } from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Canvas, DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'
import { GestureDetector } from 'react-native-gesture-handler'
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'

import {
  AXIS_FONT_SIZE,
  AXIS_WIDTH,
  LABEL_FONT_SIZE,
  computeChartLayout,
} from '@/components/charts/line/chartLayout'
import { formatAxisNumber, formatClock, formatRelative } from '@/components/charts/line/chartFormat'
import {
  ScrubCursor,
  ScrubLayer,
  useScrubReadout,
  type ScrubTarget,
  type StackReadout,
} from '@/components/charts/line/ScrubLayer'
import { SeriesLayer } from '@/components/charts/line/SeriesLayer'
import { buildSeriesPaths, type SeriesPaths } from '@/components/charts/line/seriesPaths'
import { useChartCamera, type ChartCameraState } from '@/components/charts/line/useChartCamera'
import { useChartGestures } from '@/components/charts/line/useChartGestures'
import { BandsLayer } from '@/components/charts/line/BandsLayer'
import type {
  ChartBand,
  ChartColorRamp,
  ChartPlotBox,
  ChartSeriesData,
  ChartTimeRange,
  ChartYRange,
} from '@/components/charts/line/types'
import { SelectionLayer } from '@/components/charts/line/SelectionLayer'
import { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'

const GRID_COLOR = theme.palette.slate.surface
const AXIS_TEXT_COLOR = theme.palette.slate.textDim
/** Below this window, wall-clock labels gain seconds — above it they would never change. */
const CLOCK_SECONDS_BELOW_MS = 10 * 60_000

export interface ChartSeriesSpec {
  key: string
  data: ChartSeriesData
  color: string
  axis?: 'left' | 'right'
  /** Colour by value instead of a flat `color` — see {@link ChartColorRamp}. */
  ramp?: ChartColorRamp
  /** Shown in the scrub readout; worth setting once a chart carries more than one series. */
  label?: string
  unit?: string
}

export interface ChartAxisSpec {
  range: ChartYRange
}

export interface ChartSpec {
  key: string
  label?: string
  height: number
  series: ChartSeriesSpec[]
  left: ChartAxisSpec
  right?: ChartAxisSpec
  /** Time ranges called out under the line — see {@link ChartBand}. */
  bands?: ChartBand[]
}

export interface ChartStackProps {
  charts: ChartSpec[]
  /**
   * Identity of the data on screen — a ride id, a focused metric. Zoom survives data updates
   * and resets only when this changes.
   */
  dataKey?: string
  /** `clock` labels the real time of day; `relative` counts back from the live head. */
  timeMode?: 'clock' | 'relative'
  /** Live stacks re-attach to the head when panned back to it; history stacks stay put. */
  follow?: boolean
  /**
   * Moment under the scrubbing finger, or `null`. Pass one in to drive a map or another stack
   * from the same drag; a stack given none keeps its own.
   */
  scrubTimeMs?: SharedValue<number | null>
  /**
   * Chosen stretch of time, dimmed outside and draggable by its handles. Pass one to trim a
   * ride, mark a stretch for export, or pick a window to zoom into.
   */
  selection?: SharedValue<ChartTimeRange | null>
  /** The range after a handle drag, once the finger lifts. */
  onSelectionChange?: (range: ChartTimeRange) => void
  containerStyle?: StyleProp<ViewStyle>
}

interface PreparedSeries extends ChartSeriesSpec {
  paths: SeriesPaths
}

interface PreparedChart extends ChartSpec {
  series: PreparedSeries[]
}

interface PreparedStack {
  charts: PreparedChart[]
  startMs: number
  endMs: number
  isEmpty: boolean
}

/**
 * Turn every series into its Skia paths and measure the shared time domain, in one pass.
 *
 * Preparing the data and deciding the viewport have to happen together. Reanimated schedules a
 * derived value to the UI thread as the hook is called, so a camera built before the paths
 * would reach the screen first and project the previous dataset through the new viewport — the
 * old line briefly squashed into a corner.
 */
function prepareStack(charts: ChartSpec[]): PreparedStack {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY

  const prepared = charts.map((chart) => ({
    ...chart,
    series: chart.series.map((series) => {
      const paths = buildSeriesPaths(series.data)
      if (!paths.isEmpty) {
        startMs = Math.min(startMs, paths.domainStartMs)
        endMs = Math.max(endMs, paths.domainEndMs)
      }
      return { ...series, paths }
    }),
  }))

  const hasData = Number.isFinite(startMs) && endMs > startMs
  return {
    charts: prepared,
    startMs: hasData ? startMs : 0,
    endMs: hasData ? endMs : 1,
    isEmpty: !hasData,
  }
}

/** What the scrub readout needs of a chart: a line to sample, and the axis it is read against. */
function toScrubTargets(chart: PreparedChart): ScrubTarget[] {
  return chart.series.map((series) => ({
    paths: series.paths,
    color: series.color,
    label: series.label,
    unit: series.unit,
    range: (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range,
  }))
}

/**
 * A group of charts sharing one camera, one canvas and one x scale.
 *
 * The stack is the unit of synchronisation: charts drawn together zoom and scrub together by
 * construction, and gutters are reserved once for the whole group, so a chart with a right-hand
 * axis cannot drift out of alignment with one without.
 */
export function ChartStack({
  charts,
  dataKey = '',
  timeMode = 'clock',
  follow = false,
  scrubTimeMs,
  selection,
  onSelectionChange,
  containerStyle,
}: ChartStackProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const [width, setWidth] = useState(0)
  const labelFont = useSkiaFont('600', LABEL_FONT_SIZE)
  const axisFont = useSkiaMonoFont('500', AXIS_FONT_SIZE)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width))
  }, [])

  const ownScrubTimeMs = useSharedValue<number | null>(null)
  const scrub = scrubTimeMs ?? ownScrubTimeMs

  const prepared = useMemo(() => prepareStack(charts), [charts])
  const camera = useChartCamera({
    startMs: prepared.startMs,
    endMs: prepared.endMs,
    dataKey,
  })

  const hasRightAxis = charts.some((chart) => chart.right != null)
  const layout = useMemo(
    () => computeChartLayout({ heights: charts.map((c) => c.height), width, hasRightAxis }),
    [charts, hasRightAxis, width],
  )

  // Mono digits, so one measurement holds for every label the chart will ever show.
  const glyphWidth = axisFont ? axisFont.getTextWidth('0') : 0
  const scrubCharts = useMemo(
    () =>
      prepared.charts.map((chart, index) => ({
        targets: toScrubTargets(chart),
        plot: layout.plots[index],
      })),
    [layout, prepared],
  )
  const readout = useScrubReadout({
    charts: scrubCharts,
    camera: camera.camera,
    dataKey: camera.dataKey,
    domainStartMs: prepared.startMs,
    domainEndMs: prepared.endMs,
    scrubTimeMs: scrub,
    glyphWidth,
  })

  const gesture = useChartGestures({
    camera: camera.camera,
    dataKey,
    domainStartMs: prepared.startMs,
    domainEndMs: prepared.endMs,
    plotWidth: layout.plots[0]?.width ?? 0,
    plotX: AXIS_WIDTH,
    follow,
    scrubTimeMs: scrub,
    selection,
    onSelectionCommit: onSelectionChange,
    enabled: width > 0 && !prepared.isEmpty,
  })

  const withSeconds = useDerivedValue(
    () => camera.viewport.value.endMs - camera.viewport.value.startMs < CLOCK_SECONDS_BELOW_MS,
  )
  const startLabel = useDerivedValue(() => {
    const { startMs, endMs } = camera.viewport.value
    if (timeMode === 'relative') return formatRelative(camera.domainEndMs - startMs)
    return formatClock(startMs, endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [camera.domainEndMs, timeMode])
  const endLabel = useDerivedValue(() => {
    const { startMs, endMs } = camera.viewport.value
    if (timeMode === 'relative') return formatRelative(camera.domainEndMs - endMs)
    return formatClock(endMs, endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [camera.domainEndMs, timeMode])
  const plotWidth = layout.plots[0]?.width ?? 0
  const plotsTop = layout.plots[0]?.y ?? 0
  const plotsBottom = (layout.plots.at(-1)?.y ?? 0) + (layout.plots.at(-1)?.height ?? 0)
  const endLabelX = useDerivedValue(
    () => AXIS_WIDTH + plotWidth - glyphWidth * (withSeconds.value ? 8 : 5),
    [glyphWidth, plotWidth],
  )

  return (
    <View style={containerStyle} onLayout={onLayout}>
      {width > 0 && (
        <GestureDetector gesture={gesture}>
          <Canvas style={[styles.canvas, { height: layout.canvasHeight }]}>
            {/* Before the plots: the cursor marks a moment, so it belongs behind the readings
                it points at rather than cutting across them. */}
            <ScrubCursor
              camera={camera.camera}
              dataKey={camera.dataKey}
              domainStartMs={prepared.startMs}
              domainEndMs={prepared.endMs}
              plotX={AXIS_WIDTH}
              plotWidth={plotWidth}
              top={plotsTop}
              bottom={plotsBottom}
              scrubTimeMs={scrub}
            />

            {prepared.charts.map((chart, index) => (
              <ChartPlot
                key={chart.key}
                chart={chart}
                plot={layout.plots[index]}
                labelBaseline={layout.labelBaselines[index]}
                camera={camera}
                index={index}
                readout={readout}
                scrubTargets={scrubCharts[index].targets}
                labelFont={labelFont}
                axisFont={axisFont}
              />
            ))}

            {/* Over the plots: what is outside the selection is dimmed, lines included. */}
            {selection && (
              <SelectionLayer
                selection={selection}
                camera={camera.camera}
                dataKey={camera.dataKey}
                domainStartMs={prepared.startMs}
                domainEndMs={prepared.endMs}
                plotX={AXIS_WIDTH}
                plotWidth={plotWidth}
                top={plotsTop}
                bottom={plotsBottom}
              />
            )}

            {axisFont && (
              <>
                <Text
                  font={axisFont}
                  x={AXIS_WIDTH}
                  y={layout.timeAxisBaseline}
                  text={startLabel}
                  color={AXIS_TEXT_COLOR}
                />
                <Text
                  font={axisFont}
                  x={endLabelX}
                  y={layout.timeAxisBaseline}
                  text={endLabel}
                  color={AXIS_TEXT_COLOR}
                />
              </>
            )}
          </Canvas>
        </GestureDetector>
      )}
    </View>
  )
}

interface ChartPlotProps {
  chart: PreparedChart
  plot: ChartPlotBox
  labelBaseline: number
  camera: ChartCameraState
  /** This chart's position in the stack readout. */
  index: number
  readout: SharedValue<StackReadout>
  scrubTargets: ScrubTarget[]
  labelFont: ReturnType<typeof useSkiaFont>
  axisFont: ReturnType<typeof useSkiaMonoFont>
}

function ChartPlot({
  chart,
  plot,
  labelBaseline,
  camera,
  index,
  readout,
  scrubTargets,
  labelFont,
  axisFont,
}: ChartPlotProps) {
  const clip = useMemo(
    () => ({ x: plot.x, y: plot.y, width: plot.width, height: plot.height }),
    [plot],
  )

  return (
    <>
      {labelFont && chart.label && (
        <Text
          font={labelFont}
          x={plot.x}
          y={labelBaseline}
          text={chart.label}
          color={theme.palette.slate.textSecondary}
        />
      )}

      <Group transform={[{ translateX: plot.x }, { translateY: plot.y }]}>
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
      </Group>

      <Group clip={clip}>
        <Group transform={[{ translateX: plot.x }, { translateY: plot.y }]}>
          {/* Under the series: a band is context for the line, never something drawn over it. */}
          {chart.bands && chart.bands.length > 0 && (
            <BandsLayer
              bands={chart.bands}
              plot={plot}
              camera={camera.camera}
              dataKey={camera.dataKey}
              domainStartMs={camera.domainStartMs}
              domainEndMs={camera.domainEndMs}
            />
          )}
          {chart.series.map((series) => (
            <SeriesLayer
              key={series.key}
              paths={series.paths}
              color={series.color}
              ramp={series.ramp}
              yRange={
                (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range
              }
              plot={plot}
              camera={camera.camera}
              dataKey={camera.dataKey}
            />
          ))}
        </Group>
      </Group>

      {axisFont && (
        <ScrubLayer
          targets={scrubTargets}
          plot={plot}
          index={index}
          readout={readout}
          font={axisFont}
        />
      )}

      {axisFont && <AxisTicks font={axisFont} plot={plot} range={chart.left.range} side="left" />}
      {axisFont && chart.right && (
        <AxisTicks font={axisFont} plot={plot} range={chart.right.range} side="right" />
      )}
    </>
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
      const x = side === 'left' ? plot.x - 4 - font.getTextWidth(text) : plot.x + plot.width + 4
      return { text, x, y: baselines[index] }
    })
  }, [font, plot, range, side])

  return (
    <>
      {ticks.map((tick) => (
        <Text
          key={`${side}-${tick.text}-${tick.y}`}
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
  canvas: {
    width: '100%',
  },
})
