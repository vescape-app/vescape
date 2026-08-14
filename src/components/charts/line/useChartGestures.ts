import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { MIN_SPAN_MS, projectX, unprojectX, viewportFor } from '@/components/charts/line/projection'
import {
  moveSelectionEdge,
  pickSelectionEdge,
  type SelectionEdge,
} from '@/components/charts/line/selectionMath'
import { toChartMs, toRealMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type {
  ChartCamera,
  ChartPlotBand,
  ChartTimeRange,
  ChartViewport,
} from '@/components/charts/line/types'

/**
 * How close to the live edge a pan has to land before the camera re-attaches to it. A rider who
 * drags back to the present expects the chart to keep following, not to sit a pixel behind and
 * quietly stop updating.
 */
const FOLLOW_SNAP_PX = 12

export interface ChartGestureOptions {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  /** Plot width in points; the x gutter is subtracted before this is passed in. */
  plotWidth: number
  /** Left gutter, so gesture coordinates can be read against the plot rather than the canvas. */
  plotX: number
  /** Live stacks re-attach to the head when panned back to it; history stacks never follow. */
  follow: boolean
  /**
   * Moment under the scrubbing finger, or `null` when nobody is scrubbing. Shared rather than
   * owned so a stack, a map and a readout elsewhere all read the same value with no round trip
   * through React — and so a chart driven from outside is indistinguishable from a touched one.
   */
  scrubTimeMs: SharedValue<number | null>
  /**
   * Chosen time range, or `null` when nothing is selected. Present means its handles can be
   * dragged; a drag that starts anywhere else still scrubs.
   */
  selection?: SharedValue<ChartTimeRange | null>
  /** Called once per drag, when the finger lifts — not on every frame of it. */
  onSelectionCommit?: (range: ChartTimeRange) => void
  /** The range as it is being dragged, throttled, for anything that previews it live. */
  onSelectionPreview?: (range: ChartTimeRange) => void
  /**
   * Vertical bounds of each plot in canvas coordinates, so a touch can be attributed to the
   * chart it landed on. A stack is one gesture over one canvas; without this it can say when it
   * was touched but not where.
   */
  plotBands: ChartPlotBand[]
  /** Which chart a touch landed on, by index. Fired once per gesture, before anything moves. */
  onChartTouch?: (index: number) => void
  /**
   * Cuts the plot draws through. The camera and the plot run in compacted chart time; everything
   * this hook publishes — the scrub head, the selection — is in real time, and converts here.
   */
  timeline: ChartTimeline | null
  enabled: boolean
}

/**
 * How often the JS thread hears about a range being dragged. The scrub head itself is never
 * sampled — it is a shared value, and everything that follows it reads it on the UI thread — but
 * a trim preview lands in a store and renders, so it cannot run at touch rate.
 */
const SELECTION_NOTIFY_MS = 50

/** Gap allowed between the two taps of a double tap, and how far the finger may stray. */
const DOUBLE_TAP_MS = 280
const TAP_SLOP_PX = 12

/**
 * Pinch to zoom and pan, as one gesture, entirely on the UI thread.
 *
 * Zoom and pan are the same manipulation and must be handled together: as a separate pinch and
 * two-finger pan they each computed a window from the same start state and each wrote the
 * camera, so the two disagreed every frame and the chart jumped on release.
 *
 * The rule is simply that the moment under the fingers stays under the fingers — spreading them
 * zooms in, moving them together drags the window along, and both at once do both.
 *
 * Two fingers rather than one because a single finger belongs to scrubbing: on a chart this
 * short, a drag is far more often "what was the value here" than "show me elsewhere".
 */
export function useChartGestures({
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotWidth,
  plotX,
  follow,
  scrubTimeMs,
  selection,
  onSelectionCommit,
  onSelectionPreview,
  plotBands,
  onChartTouch,
  timeline,
  enabled,
}: ChartGestureOptions) {
  const startViewport = useSharedValue<ChartViewport>({ startMs: 0, endMs: 0 })
  const startFocalRatio = useSharedValue(0)
  const lastScrubX = useSharedValue(Number.NaN)
  const draggedEdge = useSharedValue<SelectionEdge | null>(null)
  const dragOriginMs = useSharedValue(0)
  const lastDragX = useSharedValue(Number.NaN)
  const lastNotifyAt = useSharedValue(0)
  const lastTapAt = useSharedValue(0)
  const lastTapX = useSharedValue(0)
  const lastTapY = useSharedValue(0)
  const tapMoved = useSharedValue(false)
  const pinchActive = useSharedValue(false)
  const lastTwoFingerX = useSharedValue(0)

  return useMemo(() => {
    const focalRatio = (focalX: number) => {
      'worklet'
      if (plotWidth <= 0) return 0
      return Math.min(Math.max((focalX - plotX) / plotWidth, 0), 1)
    }

    /**
     * Move the cursor to the moment under `x`, clamped to the plot so a drag off the edge holds.
     *
     * A touch stream arrives faster than the screen refreshes and reports sub-pixel movement,
     * and every write re-runs the readout of every chart. Movement smaller than half a pixel
     * cannot change what is drawn, so it is dropped here rather than paid for downstream.
     */
    const scrubTo = (x: number) => {
      'worklet'
      const clamped = Math.round(Math.min(Math.max(x - plotX, 0), plotWidth) * 2) / 2
      if (clamped === lastScrubX.value) return
      lastScrubX.value = clamped
      const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
      scrubTimeMs.value = toRealMs(unprojectX(clamped, viewport, plotWidth), timeline)
    }

    /**
     * Which edge a drag starting at `x` owns: the plot is split at the midpoint of the range, so
     * either half is a target as wide as it needs to be rather than a few pixels of handle.
     */
    const edgeAt = (x: number) => {
      'worklet'
      const range = selection?.value
      if (range == null || plotWidth <= 0) return null
      const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
      return pickSelectionEdge(
        x - plotX,
        projectX(toChartMs(range.startMs, timeline), viewport, plotWidth),
        projectX(toChartMs(range.endMs, timeline), viewport, plotWidth),
      )
    }

    /**
     * Which chart a touch at `y` belongs to. The gaps between plots go to the nearer plot, so a
     * touch on a label row still counts as a touch on the chart it names.
     */
    const chartAtY = (y: number) => {
      'worklet'
      let best = -1
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < plotBands.length; i += 1) {
        const { top, bottom } = plotBands[i]
        const distance = y < top ? top - y : y > bottom ? y - bottom : 0
        if (distance >= bestDistance) continue
        bestDistance = distance
        best = i
      }
      return best
    }

    const pinch = Gesture.Pinch()
      .enabled(enabled)
      .onStart((event) => {
        'worklet'
        startViewport.value = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        startFocalRatio.value = focalRatio(event.focalX)
        pinchActive.value = true
        // The first finger of a pinch is not half of a double tap.
        lastTapAt.value = 0
      })
      .onFinalize(() => {
        'worklet'
        pinchActive.value = false
      })
      .onUpdate((event) => {
        'worklet'
        // Lifting one finger moves the focal point to the other one, and the update carrying
        // that jump would shift the window by the distance between them. The gesture is over
        // at that point, so the last one-finger frame is dropped rather than applied.
        if (event.numberOfPointers < 2) return
        const { startMs, endMs } = startViewport.value
        const span = endMs - startMs
        if (span <= 0 || plotWidth <= 0) return

        const anchorMs = startMs + startFocalRatio.value * span
        const nextSpan = Math.max(MIN_SPAN_MS, span / Math.max(event.scale, 0.0001))
        const nextStart = anchorMs - focalRatio(event.focalX) * nextSpan
        const nextEnd = nextStart + nextSpan

        const snapMs = (nextSpan / plotWidth) * FOLLOW_SNAP_PX
        const atHead = nextEnd >= domainEndMs - snapMs
        camera.value = {
          spanMs: nextSpan,
          endMs: follow && atHead ? null : nextEnd,
          key: dataKey,
        }
      })

    /**
     * Two fingers moved together, without spreading.
     *
     * A pinch only activates once the fingers change distance, so a rider who lays two fingers
     * down and slides sideways moves nothing until they zoom first. This carries that case, and
     * yields to the pinch the moment it activates: it shifts the camera by the frame's delta
     * rather than from a start window, so the handoff in either direction has nothing to disagree
     * about.
     */
    const drag = Gesture.Pan()
      .enabled(enabled)
      .minPointers(2)
      .averageTouches(true)
      .onStart((event) => {
        'worklet'
        lastTwoFingerX.value = event.translationX
      })
      .onUpdate((event) => {
        'worklet'
        // As in the pinch: the frame where a finger lifts carries a jump to the remaining one.
        if (event.numberOfPointers < 2) return
        const dx = event.translationX - lastTwoFingerX.value
        lastTwoFingerX.value = event.translationX
        if (pinchActive.value || dx === 0 || plotWidth <= 0) return
        const { startMs, endMs } = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        const span = endMs - startMs
        if (span <= 0) return
        const nextEnd = endMs - (dx / plotWidth) * span
        const snapMs = (span / plotWidth) * FOLLOW_SNAP_PX
        camera.value = {
          spanMs: span,
          endMs: follow && nextEnd >= domainEndMs - snapMs ? null : nextEnd,
          key: dataKey,
        }
      })

    /** Back to the whole ride. */
    const fitToDomain = () => {
      'worklet'
      camera.value = {
        spanMs: domainEndMs - domainStartMs,
        endMs: follow ? null : domainEndMs,
        key: dataKey,
      }
    }

    const scrub = Gesture.Pan()
      .enabled(enabled)
      // One finger only: the moment a second lands the drag ends and the pinch takes over, so
      // starting a zoom never drags the cursor along with it.
      .maxPointers(1)
      .minDistance(0)
      // Touch-down, before the pan has decided it is a drag — a tap that never moves far enough
      // to activate still lands here, and both of these are answers about where the finger went
      // down rather than about dragging.
      .onBegin((event) => {
        'worklet'
        // The second tap of a double tap fits the ride back into view. Counted here rather than
        // by a Tap gesture: a pan with no minimum distance activates on the first touch and wins
        // the race, and making it wait for a tap to fail would delay every scrub by the
        // double-tap timeout — the one thing that has to feel instant.
        const now = Date.now()
        const isSecondTap =
          now - lastTapAt.value < DOUBLE_TAP_MS &&
          Math.abs(event.x - lastTapX.value) < TAP_SLOP_PX &&
          Math.abs(event.y - lastTapY.value) < TAP_SLOP_PX
        lastTapAt.value = isSecondTap ? 0 : now
        lastTapX.value = event.x
        lastTapY.value = event.y
        tapMoved.value = false
        if (isSecondTap) fitToDomain()
        if (onChartTouch) {
          const index = chartAtY(event.y)
          if (index >= 0) runOnJS(onChartTouch)(index)
        }
      })
      .onStart((event) => {
        'worklet'
        lastScrubX.value = Number.NaN
        lastNotifyAt.value = 0
        // While a range is on screen the drag belongs to it: a selection is something the rider
        // is adjusting, and reading values off the line is what the chart does the rest of the time.
        const edge = edgeAt(event.x)
        draggedEdge.value = edge
        if (edge == null) {
          scrubTo(event.x)
          return
        }
        // Where the edge sat when the finger landed; the drag moves it from there by translation.
        lastDragX.value = Number.NaN
        const range = selection?.value
        dragOriginMs.value =
          range == null ? 0 : toChartMs(edge === 'start' ? range.startMs : range.endMs, timeline)
      })
      .onUpdate((event) => {
        'worklet'
        if (
          Math.abs(event.translationX) > TAP_SLOP_PX ||
          Math.abs(event.translationY) > TAP_SLOP_PX
        )
          tapMoved.value = true
        const edge = draggedEdge.value
        if (edge == null) {
          scrubTo(event.x)
          return
        }
        const range = selection == null ? null : selection.value
        if (selection == null || range == null) return
        // Same half-pixel quantisation as scrubbing: touches arrive faster than frames and report
        // sub-pixel movement, and a move too small to redraw is not worth waking the layer for.
        const translationX = Math.round(event.translationX * 2) / 2
        if (translationX === lastDragX.value) return
        lastDragX.value = translationX
        const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        // The edge is dragged across the plot, so the arithmetic happens in chart time and the
        // result is published back in the real time the rest of the app trims and stores.
        const movedChart = moveSelectionEdge({
          edge,
          range: {
            startMs: toChartMs(range.startMs, timeline),
            endMs: toChartMs(range.endMs, timeline),
          },
          originMs: dragOriginMs.value,
          translationX,
          plotWidth,
          viewportSpanMs: viewport.endMs - viewport.startMs,
          domainStartMs,
          domainEndMs,
        })
        const moved = {
          startMs: toRealMs(movedChart.startMs, timeline),
          endMs: toRealMs(movedChart.endMs, timeline),
        }
        selection.value = moved
        // Same sampling as a scrub, for the same reason: whatever previews the range live —
        // a stats bar, a label — renders through React and cannot keep up with a touch stream.
        if (onSelectionPreview == null) return
        const now = Date.now()
        if (now - lastNotifyAt.value < SELECTION_NOTIFY_MS) return
        lastNotifyAt.value = now
        runOnJS(onSelectionPreview)(moved)
      })
      .onFinalize(() => {
        'worklet'
        const range = draggedEdge.value != null ? selection?.value : null
        draggedEdge.value = null
        // A touch that travelled is a drag, and a drag is never half of a double tap.
        if (tapMoved.value) lastTapAt.value = 0
        scrubTimeMs.value = null
        // Committed on release rather than per frame: the range is what the rest of the app acts
        // on, and re-running that for every pixel of a drag is what a shared value exists to avoid.
        if (range != null && onSelectionCommit) runOnJS(onSelectionCommit)(range)
      })

    return Gesture.Simultaneous(pinch, drag, scrub)
  }, [
    camera,
    dataKey,
    domainEndMs,
    domainStartMs,
    dragOriginMs,
    draggedEdge,
    enabled,
    follow,
    lastDragX,
    lastNotifyAt,
    lastScrubX,
    lastTapAt,
    lastTapX,
    lastTapY,
    lastTwoFingerX,
    onChartTouch,
    onSelectionCommit,
    onSelectionPreview,
    pinchActive,
    plotBands,
    plotWidth,
    plotX,
    scrubTimeMs,
    selection,
    startFocalRatio,
    tapMoved,
    timeline,
    startViewport,
  ])
}
