import { useCallback, useEffect, useRef, useState } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'

const SETTLE_MS = 220

export function useSettledZoomWindow(): ChartTimeRange | null {
  const [window, setWindow] = useState<ChartTimeRange | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settle = useCallback((next: ChartTimeRange | null) => {
    if (timer.current) clearTimeout(timer.current)
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
