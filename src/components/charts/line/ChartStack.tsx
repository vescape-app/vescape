import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import {
  AXIS_FONT_SIZE,
  AXIS_WIDTH,
  CHART_GAP,
  LABEL_FONT_SIZE,
  LABEL_HEIGHT,
  computeRowBands,
  plotWidthFor,
} from '@/components/charts/line/chartLayout'
import {
  ChartStackProvider,
  type ChartStackContextValue,
} from '@/components/charts/line/ChartStackContext'
import { ChartTimeAxis } from '@/components/charts/line/ChartTimeAxis'
import { LineChart } from '@/components/charts/line/LineChart'
import { SCRUB_FONT_SIZE, useScrubReadout } from '@/components/charts/line/ScrubLayer'
import {
  compactBands,
  compactCharts,
  prepareStack,
  toScrubTargets,
} from '@/components/charts/line/stackData'
import { useChartCamera } from '@/components/charts/line/useChartCamera'
import { useChartGestures } from '@/components/charts/line/useChartGestures'
import { toChartMs, toRealMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartSpec, ChartTimeRange } from '@/components/charts/line/types'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'

export type { ChartSpec } from '@/components/charts/line/types'

/** Slack when deciding the camera is showing everything, so rounding cannot leave it "zoomed". */
const FULL_VIEW_EPSILON_MS = 1
export const CHART_CHANGE_FADE_MS = 120

export interface ChartStackProps {
  /**
   * Time ranges called out across the whole stack rather than under one line — a Favorite the
   * rider picked out. Drawn through every chart at the same x, so the eye reads the same stretch
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
   * the whole column, so this is how a consumer follows which metric the rider is looking at.
   */
  onChartTouch?: (key: string) => void
  /** Mark the last sample of every series. */
  showHead?: boolean
  /** Fade chart rows as the visible metric set changes. Initial rows do not animate. */
  animateChartChanges?: boolean
  /** Keys still visible while a deselected row is retained long enough to fade out. */
  visibleChartKeys?: ReadonlySet<string>
  containerStyle?: StyleProp<ViewStyle>
}

/**
 * A group of charts sharing one camera, one x scale and one gesture.
 *
 * Each chart draws into its own canvas and is placed by ordinary layout, so opening or closing one
 * costs the others nothing: Skia re-records a picture on every commit and lands it a frame or two
 * late, and a stack drawn into one canvas paid that for the whole group whenever any part of it
 * changed. What holds the group together is shared values, not shared geometry — see
 * {@link ChartStackProvider}.
 *
 * Gutters are reserved once for the whole stack, so a chart with a right-hand axis cannot drift
 * out of alignment with one without.
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
  animateChartChanges = false,
  visibleChartKeys,
  containerStyle,
}: ChartStackProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  useRenderRateWarning('ChartStack')
  const [width, setWidth] = useState(0)
  const labelFont = useSkiaFont('600', LABEL_FONT_SIZE)
  const axisFont = useSkiaMonoFont('500', AXIS_FONT_SIZE)
  const scrubFont = useSkiaMonoFont('600', SCRUB_FONT_SIZE)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width))
  }, [])

  const ownScrubTimeMs = useSharedValue<number | null>(null)
  const scrub = scrubTimeMs ?? ownScrubTimeMs

  // Cutting happens here, once per data change: the canvases below draw chart time throughout, so
  // no worklet pays for a conversion per frame.
  const compacted = useMemo(() => compactCharts(charts, timeline), [charts, timeline])
  const stackBands = useMemo(() => compactBands(bands, timeline), [bands, timeline])
  const prepared = useMemo(() => prepareStack(compacted, dataKey), [compacted, dataKey])
  const previousChartKeysRef = useRef<ReadonlySet<string>>(
    new Set(prepared.charts.map((chart) => chart.key)),
  )
  const addedChartKeys = new Set(
    prepared.charts
      .map((chart) => chart.key)
      .filter((key) => !previousChartKeysRef.current.has(key)),
  )
  useEffect(() => {
    previousChartKeysRef.current = new Set(prepared.charts.map((chart) => chart.key))
  }, [prepared.charts])
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

  const plotWidth = plotWidthFor(width)

  // Mono digits, so one measurement holds for every label the chart will ever show.
  const glyphWidth = axisFont ? axisFont.getTextWidth('0') : 0
  const scrubGlyphWidth = scrubFont ? scrubFont.getTextWidth('0') : 0
  // Every chart draws at the same origin in its own canvas, so the readout is laid out against
  // one plot box per chart height and never against a position in the stack.
  const scrubCharts = useMemo(
    () =>
      prepared.charts.map((chart) => ({
        targets: toScrubTargets(chart),
        plot: { x: AXIS_WIDTH, y: LABEL_HEIGHT, width: plotWidth, height: chart.height },
      })),
    [plotWidth, prepared],
  )
  const readout = useScrubReadout({
    charts: scrubCharts,
    camera: camera.camera,
    dataKey: camera.dataKey,
    domainStartMs: prepared.startMs,
    domainEndMs: prepared.endMs,
    scrubTimeMs: scrub,
    timeline,
    glyphWidth: scrubGlyphWidth,
  })

  const plotBands = useMemo(
    () => computeRowBands(compacted.map((chart) => chart.height)),
    [compacted],
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
    plotWidth,
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

  const context = useMemo<ChartStackContextValue>(
    () => ({
      camera: camera.camera,
      dataKey: camera.dataKey,
      domainStartMs: prepared.startMs,
      domainEndMs: prepared.endMs,
      scrubTimeMs: scrub,
      selection,
      readout,
      timeline,
      stackBands,
      isEmpty: prepared.isEmpty,
      plotWidth,
      labelFont,
      axisFont,
      scrubFont,
      showHead,
    }),
    [
      axisFont,
      camera.camera,
      camera.dataKey,
      labelFont,
      plotWidth,
      prepared.endMs,
      prepared.isEmpty,
      prepared.startMs,
      readout,
      scrub,
      scrubFont,
      selection,
      showHead,
      stackBands,
      timeline,
    ],
  )

  return (
    <View style={containerStyle} onLayout={onLayout}>
      {width > 0 && (
        <ChartStackProvider value={context}>
          <GestureDetector gesture={gesture}>
            <View style={styles.column}>
              {prepared.charts.map((chart, index) => (
                <ChartRow
                  key={chart.key}
                  visible={!visibleChartKeys || visibleChartKeys.has(chart.key)}
                  fadeIn={animateChartChanges && addedChartKeys.has(chart.key)}
                >
                  <LineChart chart={chart} width={width} index={index} />
                </ChartRow>
              ))}
              <ChartTimeAxis timeMode={timeMode} glyphWidth={glyphWidth} />
            </View>
          </GestureDetector>
        </ChartStackProvider>
      )}
    </View>
  )
}

interface ChartRowProps {
  visible: boolean
  fadeIn: boolean
  children: React.ReactNode
}

function ChartRow({ visible, fadeIn, children }: ChartRowProps) {
  const opacity = useSharedValue(fadeIn ? 0 : visible ? 1 : 0)
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: CHART_CHANGE_FADE_MS })
  }, [opacity, visible])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return <Animated.View style={style}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  column: { width: '100%', gap: CHART_GAP },
})
