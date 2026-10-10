import { useCallback, useEffect, useRef, useState } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'

/**
 * How long the pinch has to stop before anything outside the chart follows it.
 *
 * The map camera is not something to animate at touch rate: retargeting it every frame of a pinch
 * fights the spring already flying towards the previous target, and the map lurches. Stats have
 * the same problem for a different reason — every window is a fresh pass over the ride's samples.
 * Waiting for the fingers to settle costs nothing: the chart is what the rider is looking at while
 * zooming, and what follows is one clean update.
 */
const SETTLE_MS = 220

/**
 * The window the chart is zoomed into, sampled onto the JS thread only once the fingers stop.
 *
 * `null` while the chart shows the whole ride. The zoom itself lives on the UI thread — see
 * {@link zoomWindowMs} — and everything that renders through React reads it through here, so the
 * settle rule is written once and the map and the stats can never disagree about when a pinch is
 * over.
 */
export function useSettledZoomWindow(): ChartTimeRange | null {
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
      scheduleOnRN(settle, next)
    },
    [settle],
  )

  return window
}
