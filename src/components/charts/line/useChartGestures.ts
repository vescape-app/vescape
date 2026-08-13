import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

import { MIN_SPAN_MS, unprojectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartCamera, ChartViewport } from '@/components/charts/line/types'

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
  enabled: boolean
}

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
  enabled,
}: ChartGestureOptions) {
  const startViewport = useSharedValue<ChartViewport>({ startMs: 0, endMs: 0 })
  const startFocalRatio = useSharedValue(0)
  const lastScrubX = useSharedValue(Number.NaN)

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
      scrubTimeMs.value = unprojectX(clamped, viewport, plotWidth)
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
        scrubTo(event.x)
      })
      .onUpdate((event) => {
        'worklet'
        scrubTo(event.x)
      })
      .onFinalize(() => {
        'worklet'
        scrubTimeMs.value = null
      })

    return Gesture.Race(fit, Gesture.Simultaneous(pinch, scrub))
  }, [
    camera,
    dataKey,
    domainEndMs,
    domainStartMs,
    enabled,
    follow,
    lastScrubX,
    plotWidth,
    plotX,
    scrubTimeMs,
    startFocalRatio,
    startViewport,
  ])
}
