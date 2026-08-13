import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { MIN_SPAN_MS, projectX, unprojectX, viewportFor } from '@/components/charts/line/projection'
import {
  moveSelectionEdge,
  pickSelectionEdge,
  type SelectionEdge,
} from '@/components/charts/line/selectionMath'
import type { ChartCamera, ChartTimeRange, ChartViewport } from '@/components/charts/line/types'

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
  /** Scrub position for the JS side, throttled; always ends with `null`. */
  onScrubTimeChange?: (timeMs: number | null) => void
  /** A touch has landed. Fired once per gesture, before anything moves. */
  onGestureStart?: () => void
  enabled: boolean
}

/**
 * How often the JS thread hears about a scrub. Fast enough that a map marker tracks the finger,
 * slow enough that a React render per touch sample cannot happen.
 */
const SCRUB_NOTIFY_MS = 50

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
  onScrubTimeChange,
  onGestureStart,
  enabled,
}: ChartGestureOptions) {
  const startViewport = useSharedValue<ChartViewport>({ startMs: 0, endMs: 0 })
  const startFocalRatio = useSharedValue(0)
  const lastScrubX = useSharedValue(Number.NaN)
  const draggedEdge = useSharedValue<SelectionEdge | null>(null)
  const dragOriginMs = useSharedValue(0)
  const lastDragX = useSharedValue(Number.NaN)
  const lastNotifyAt = useSharedValue(0)

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
      const timeMs = unprojectX(clamped, viewport, plotWidth)
      scrubTimeMs.value = timeMs
      // The canvas follows the shared value directly; the JS side hears a sampled version of it,
      // because everything it drives — a map marker, a native focus request — renders through
      // React and cannot keep up with a touch stream.
      if (onScrubTimeChange == null) return
      const now = Date.now()
      if (now - lastNotifyAt.value < SCRUB_NOTIFY_MS) return
      lastNotifyAt.value = now
      runOnJS(onScrubTimeChange)(timeMs)
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
        projectX(range.startMs, viewport, plotWidth),
        projectX(range.endMs, viewport, plotWidth),
      )
    }

    const pinch = Gesture.Pinch()
      .enabled(enabled)
      .onStart((event) => {
        'worklet'
        startViewport.value = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        startFocalRatio.value = focalRatio(event.focalX)
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

    const fit = Gesture.Tap()
      .enabled(enabled)
      .numberOfTaps(2)
      .onEnd(() => {
        'worklet'
        camera.value = {
          spanMs: domainEndMs - domainStartMs,
          endMs: follow ? null : domainEndMs,
          key: dataKey,
        }
      })

    const scrub = Gesture.Pan()
      .enabled(enabled)
      // One finger only: the moment a second lands the drag ends and the pinch takes over, so
      // starting a zoom never drags the cursor along with it.
      .maxPointers(1)
      .minDistance(0)
      .onStart((event) => {
        'worklet'
        lastScrubX.value = Number.NaN
        lastNotifyAt.value = 0
        if (onGestureStart) runOnJS(onGestureStart)()
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
        dragOriginMs.value = range == null ? 0 : edge === 'start' ? range.startMs : range.endMs
      })
      .onUpdate((event) => {
        'worklet'
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
        const moved = moveSelectionEdge({
          edge,
          range,
          originMs: dragOriginMs.value,
          translationX,
          plotWidth,
          viewportSpanMs: viewport.endMs - viewport.startMs,
          domainStartMs,
          domainEndMs,
        })
        selection.value = moved
        // Same sampling as a scrub, for the same reason: whatever previews the range live —
        // a stats bar, a label — renders through React and cannot keep up with a touch stream.
        if (onSelectionPreview == null) return
        const now = Date.now()
        if (now - lastNotifyAt.value < SCRUB_NOTIFY_MS) return
        lastNotifyAt.value = now
        runOnJS(onSelectionPreview)(moved)
      })
      .onFinalize(() => {
        'worklet'
        const range = draggedEdge.value != null ? selection?.value : null
        draggedEdge.value = null
        scrubTimeMs.value = null
        // Unconditionally, and outside the throttle: whoever is following the finger has to be
        // told it is gone, however briefly it was down.
        if (onScrubTimeChange) runOnJS(onScrubTimeChange)(null)
        // Committed on release rather than per frame: the range is what the rest of the app acts
        // on, and re-running that for every pixel of a drag is what a shared value exists to avoid.
        if (range != null && onSelectionCommit) runOnJS(onSelectionCommit)(range)
      })

    return Gesture.Race(fit, Gesture.Simultaneous(pinch, scrub))
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
    onGestureStart,
    onScrubTimeChange,
    onSelectionCommit,
    onSelectionPreview,
    plotWidth,
    plotX,
    scrubTimeMs,
    selection,
    startFocalRatio,
    startViewport,
  ])
}
