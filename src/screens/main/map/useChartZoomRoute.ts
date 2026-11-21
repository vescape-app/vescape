import { useMemo } from 'react'

import { useSettledZoomWindow } from '@/modules/history/hooks/useSettledZoomWindow'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

export function useChartZoomRoute(gpsSamples: HistoryGpsSample[]): [number, number][] {
  const window = useSettledZoomWindow()

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
