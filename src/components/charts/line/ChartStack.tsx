import { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { Canvas, DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

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
import { useStackTransition } from '@/components/charts/line/useStackTransition'
import { useChartGestures } from '@/components/charts/line/useChartGestures'
import { BandsLayer } from '@/components/charts/line/BandsLayer'
import { GapMarkersLayer } from '@/components/charts/line/GapMarkersLayer'
import type {
  ChartBand,
  ChartColorRamp,
  ChartPlotBox,
  ChartSeriesData,
  ChartTimeRange,
  ChartYRange,
} from '@/components/charts/line/types'
import { SelectionLayer } from '@/components/charts/line/SelectionLayer'
import { toChartMs, toRealMs, type ChartTimeline } from '@/components/charts/line/timeline'
import { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'

const GRID_COLOR = theme.palette.slate.surface
const AXIS_TEXT_COLOR = theme.palette.slate.textDim
/** Below this window, wall-clock labels gain seconds — above it they would never change. */
const CLOCK_SECONDS_BELOW_MS = 10 * 60_000
/** Slack when deciding the camera is showing everything, so rounding cannot leave it "zoomed". */
const FULL_VIEW_EPSILON_MS = 1

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
  /**
   * Time ranges called out across the whole stack rather than under one line — a Favorite the
   * rider picked out. Drawn as one column through every plot, so the eye reads the same stretch
   * on every metric at once.
   */
  bands?: ChartBand[]
  charts: ChartSpec[]
  /**
   * Long idle stretches to cut out of the plot — see {@link ChartTimeline}.
   *
   * The chart draws compacted time; every time value crossing this boundary, in either direction,
   * stays real. Nothing outside the canvas has to know a ride was cut.
   */
  timeline?: ChartTimeline | null
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
   * Where to publish the window the camera is showing, or `null` while it shows everything.
   * Pass one to mark the zoomed stretch somewhere else — on a map, in a second chart.
   */
  zoomWindowMs?: SharedValue<ChartTimeRange | null>
  /**
   * Window to open at, in wall-clock ms, or `null` to open showing everything.
   *
   * Read once per dataset, unlike {@link zoomWindowMs}, which the stack only ever writes: this is
   * how a second stack of the same ride opens on the stretch the rider had already pinched into.
   */
  initialZoomMs?: ChartTimeRange | null
  /**
   * Chosen stretch of time, dimmed outside and draggable by its handles. Pass one to trim a
   * ride, mark a stretch for export, or pick a window to zoom into.
   */
  selection?: SharedValue<ChartTimeRange | null>
  /** The range after a handle drag, once the finger lifts. */
  onSelectionChange?: (range: ChartTimeRange) => void
  /** The range while a handle is being dragged, throttled. */
  onSelectionPreview?: (range: ChartTimeRange) => void
  /**
   * The chart a touch landed on, by its key. Fired once per gesture: a stack is one gesture over
   * one canvas, so this is how a consumer follows which metric the rider is looking at.
   */
  onChartTouch?: (key: string) => void
  /** Mark the last sample of every series. */
  showHead?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

interface PreparedSeries extends ChartSeriesSpec {
  paths: SeriesPaths
}

interface PreparedChart extends ChartSpec {
  series: PreparedSeries[]
}

/**
 * One series' compacted data and paths, kept across renders.
 *
 * Rebuilding these is what a stack spends its time on, and a metric toggle changes the chart list
 * without touching a single sample. Without this the whole ride is re-cut and re-pathed on every
 * toggle, the canvas lands a couple of frames after the layout, and the stack visibly snaps into
 * place after the container has already resized around it.
 */
interface SeriesEntry {
  /** Identity of the data this was built from, in wall-clock terms. */
  source: ChartSeriesData
  timeline: ChartTimeline | null
  data: ChartSeriesData
  paths: SeriesPaths
}

type SeriesCache = Map<string, SeriesEntry>

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
function prepareStack(
  charts: ChartSpec[],
  timeline: ChartTimeline | null,
  cache: SeriesCache,
): PreparedStack {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  const seen = new Set<string>()

  const prepared = charts.map((chart) => ({
    ...chart,
    bands: compactBands(chart.bands, timeline),
    series: chart.series.map((series) => {
      const cacheKey = `${chart.key}/${series.key}`
      seen.add(cacheKey)
      const cached = cache.get(cacheKey)
      const entry =
        cached && cached.source === series.data && cached.timeline === timeline
          ? cached
          : buildSeriesEntry(series.data, timeline)
      cache.set(cacheKey, entry)
      if (!entry.paths.isEmpty) {
        startMs = Math.min(startMs, entry.paths.domainStartMs)
        endMs = Math.max(endMs, entry.paths.domainEndMs)
      }
      return { ...series, data: entry.data, paths: entry.paths }
    }),
  }))

  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key)
  }

  const hasData = Number.isFinite(startMs) && endMs > startMs
  return {
    charts: prepared,
    startMs: hasData ? startMs : 0,
    endMs: hasData ? endMs : 1,
    isEmpty: !hasData,
  }
}

/** Cut one series to chart time and build its paths — the expensive half of a stack. */
function buildSeriesEntry(source: ChartSeriesData, timeline: ChartTimeline | null): SeriesEntry {
  const data =
    timeline == null
      ? source
      : { ts: source.ts.map((ms) => toChartMs(ms, timeline)), vs: source.vs }
  return { source, timeline, data, paths: buildSeriesPaths(data) }
}

function compactBands(
  bands: ChartBand[] | undefined,
  timeline: ChartTimeline | null,
): ChartBand[] | undefined {
  if (timeline == null || bands == null) return bands
  return bands.map((band) => ({
    ...band,
    startMs: toChartMs(band.startMs, timeline),
    endMs: toChartMs(band.endMs, timeline),
  }))
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
  zoomWindowMs,
  initialZoomMs,
  selection,
  onSelectionChange,
  onSelectionPreview,
  onChartTouch,
  bands,
  timeline = null,
  showHead = false,
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

  // Cutting happens here, once per data change: the canvas below draws chart time throughout, so
  // no worklet pays for a conversion per frame. Per series, and cached, so opening or closing a
  // chart costs only the chart that changed.
  const seriesCache = useRef<SeriesCache>(null)
  seriesCache.current ??= new Map()
  const stackBands = useMemo(() => compactBands(bands, timeline), [bands, timeline])
  const prepared = useMemo(
    () => prepareStack(charts, timeline, seriesCache.current!),
    [charts, timeline],
  )
  const camera = useChartCamera({
    startMs: prepared.startMs,
    endMs: prepared.endMs,
    dataKey,
  })

  // Adopting a window is a one-off per dataset: after this the camera belongs to the rider's
  // gestures, and re-applying it would snap the stack back under their finger.
  const adoptedZoomKey = useRef<string | null>(null)
  if (adoptedZoomKey.current !== dataKey && !prepared.isEmpty) {
    adoptedZoomKey.current = dataKey
    if (initialZoomMs) {
      const startMs = toChartMs(initialZoomMs.startMs, timeline)
      const endMs = toChartMs(initialZoomMs.endMs, timeline)
      if (endMs > startMs) camera.camera.value = { spanMs: endMs - startMs, endMs, key: dataKey }
    }
  }

  // The drawing surface only ever grows. Resizing it is what used to make a toggle jump: the
  // canvas takes its new height at commit while the picture inside it lands a frame or two later,
  // so for those frames the old drawing hangs off the wrong edge.
  const surfaceHeight = useRef(0)
  const layout = useMemo(() => {
    const heights = charts.map((c) => c.height)
    const natural = computeChartLayout({ heights, width })
    surfaceHeight.current = Math.max(surfaceHeight.current, natural.canvasHeight)
    return computeChartLayout({ heights, width, surfaceHeight: surfaceHeight.current })
  }, [charts, width])
  const chartKeys = useMemo(() => charts.map((c) => c.key), [charts])
  const transition = useStackTransition(chartKeys, layout)
  // The container grows from its top edge, since the panel it lives in is pinned to the bottom of
  // the screen. The canvas is pinned to that same bottom edge, so the room being made appears
  // above the stack rather than being taken out of it.
  const containerHeight = useAnimatedStyle(
    () => ({
      height:
        transition.fromHeight +
        (transition.toHeight - transition.fromHeight) * transition.progress.value,
    }),
    [transition],
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
    timeline,
    glyphWidth,
  })

  const plotBands = useMemo(
    () => layout.plots.map((plot) => ({ top: plot.y, bottom: plot.y + plot.height })),
    [layout],
  )
  const handleChartTouch = useCallback(
    (index: number) => {
      const key = charts[index]?.key
      if (key != null) onChartTouch?.(key)
    },
    [charts, onChartTouch],
  )

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
    onSelectionPreview,
    plotBands,
    onChartTouch: handleChartTouch,
    timeline,
    enabled: width > 0 && !prepared.isEmpty,
  })

  // Mirrored rather than owned: the camera belongs to the stack, and a consumer outside it wants
  // the window in wall-clock terms without knowing what a camera is.
  useAnimatedReaction(
    () => camera.viewport.value,
    (window) => {
      if (zoomWindowMs == null) return
      const whole =
        window.startMs <= prepared.startMs + FULL_VIEW_EPSILON_MS &&
        window.endMs >= prepared.endMs - FULL_VIEW_EPSILON_MS
      zoomWindowMs.value = whole
        ? null
        : { startMs: toRealMs(window.startMs, timeline), endMs: toRealMs(window.endMs, timeline) }
    },
    [prepared.endMs, prepared.startMs, timeline, zoomWindowMs],
  )

  const withSeconds = useDerivedValue(
    () => camera.viewport.value.endMs - camera.viewport.value.startMs < CLOCK_SECONDS_BELOW_MS,
  )
  const startLabel = useDerivedValue(() => {
    const { startMs, endMs } = camera.viewport.value
    if (timeMode === 'relative') return formatRelative(camera.domainEndMs - startMs)
    return formatClock(toRealMs(startMs, timeline), endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [camera.domainEndMs, timeMode, timeline])
  const endLabel = useDerivedValue(() => {
    const { startMs, endMs } = camera.viewport.value
    if (timeMode === 'relative') return formatRelative(camera.domainEndMs - endMs)
    return formatClock(toRealMs(endMs, timeline), endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [camera.domainEndMs, timeMode, timeline])
  const plotWidth = layout.plots[0]?.width ?? 0
  const plotsTop = layout.plots[0]?.y ?? 0
  const plotsBottom = (layout.plots.at(-1)?.y ?? 0) + (layout.plots.at(-1)?.height ?? 0)
  // One box covering every plot and the gaps between them, for bands that belong to the ride
  // rather than to a metric.
  const stackPlot = useMemo(
    () => ({ x: AXIS_WIDTH, y: plotsTop, width: plotWidth, height: plotsBottom - plotsTop }),
    [plotWidth, plotsBottom, plotsTop],
  )
  const endLabelX = useDerivedValue(
    () => AXIS_WIDTH + plotWidth - glyphWidth * (withSeconds.value ? 8 : 5),
    [glyphWidth, plotWidth],
  )

  return (
    <Animated.View style={[containerStyle, styles.container, containerHeight]} onLayout={onLayout}>
      {width > 0 && (
        <GestureDetector gesture={gesture}>
          <Canvas style={[styles.canvas, { height: layout.surfaceHeight }]}>
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
              timeline={timeline}
            />

            {stackBands && stackBands.length > 0 && (
              <Group transform={[{ translateX: AXIS_WIDTH }, { translateY: plotsTop }]}>
                <BandsLayer
                  bands={stackBands}
                  plot={stackPlot}
                  camera={camera.camera}
                  dataKey={camera.dataKey}
                  domainStartMs={prepared.startMs}
                  domainEndMs={prepared.endMs}
                />
              </Group>
            )}

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
                showHead={showHead}
                scrubTimeMs={scrub}
                labelFont={labelFont}
                axisFont={axisFont}
                entering={transition.entering[index]}
                progress={transition.progress}
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
                timeline={timeline}
              />
            )}

            {axisFont && (
              <GapMarkersLayer
                timeline={timeline}
                camera={camera.camera}
                dataKey={camera.dataKey}
                domainStartMs={prepared.startMs}
                domainEndMs={prepared.endMs}
                plotX={AXIS_WIDTH}
                plotWidth={plotWidth}
                top={plotsTop}
                bottom={plotsBottom}
                labelBaseline={layout.timeAxisBaseline}
                font={axisFont}
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
    </Animated.View>
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
  showHead: boolean
  scrubTimeMs: SharedValue<number | null>
  labelFont: ReturnType<typeof useSkiaFont>
  axisFont: ReturnType<typeof useSkiaMonoFont>
  /** New to the stack, so it fades in rather than appearing over the chart it displaced. */
  entering: boolean
  progress: SharedValue<number>
}

function ChartPlot({
  chart,
  plot,
  labelBaseline,
  camera,
  index,
  readout,
  scrubTargets,
  showHead,
  scrubTimeMs,
  labelFont,
  axisFont,
  entering,
  progress,
}: ChartPlotProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const clip = useMemo(
    () => ({ x: plot.x, y: plot.y, width: plot.width, height: plot.height }),
    [plot],
  )
  const opacity = useDerivedValue(() => (entering ? progress.value : 1), [entering])

  return (
    <Group opacity={opacity}>
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
              showHead={showHead}
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
    </Group>
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
      {ticks.map((tick, index) => (
        <Text
          // Keyed by slot, not by value: a tick that moves or reads differently is the same tick,
          // and remounting it on every layout change is what made the axis flicker.
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
  // The canvas is held at the taller of the two layouts mid-transition; the container is what
  // gives the stack its height, so what has not arrived yet stays cut off.
  container: {
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
  },
})
