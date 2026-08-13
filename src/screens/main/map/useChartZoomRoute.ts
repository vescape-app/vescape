import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

/**
 * How long the pinch has to stop before the map reframes.
 *
 * The camera is not something to animate at touch rate: retargeting it every frame of a pinch
 * fights the spring that is already flying towards the previous target, and the map ends up
 * lurching. Waiting for the fingers to settle costs nothing — the chart is what the rider is
 * looking at while zooming — and the reframe that follows is one clean spring.
 */
const SETTLE_MS = 220

/**
 * The stretch of route the chart is zoomed into, as coordinates the camera can be fitted to.
 *
 * Empty while the chart shows the whole ride, so the map falls back to framing all of it.
 */
export function useChartZoomRoute(gpsSamples: HistoryGpsSample[]): [number, number][] {
  const [window, setWindow] = useState<ChartTimeRange | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settle = useCallback((next: ChartTimeRange | null) => {
    if (timer.current) clearTimeout(timer.current)
    // A release back to the whole ride is not a zoom to wait out.
    if (next == null) {
      setWindow(null)
      return
    }
    timer.current = setTimeout(() => setWindow(next), SETTLE_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  useAnimatedReaction(
    () => zoomWindowMs.value,
    (next) => {
      'worklet'
      runOnJS(settle)(next)
    },
    [settle],
  )

  return useMemo(() => {
    if (window == null) return []
    const route: [number, number][] = []
    for (const sample of gpsSamples) {
      if (sample.capturedAtMs < window.startMs) continue
      if (sample.capturedAtMs > window.endMs) break
      route.push([sample.longitude, sample.latitude])
    }
    return route
  }, [gpsSamples, window])
}
