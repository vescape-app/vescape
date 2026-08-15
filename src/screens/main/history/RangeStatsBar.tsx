import { useMemo } from 'react'
import type { HistoryGpsSample, TelemetrySample } from 'vescape-core'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { useSettledZoomWindow } from '@/modules/history/hooks/useSettledZoomWindow'
import { summarizeFavoriteRange } from '@/modules/history/lib/favoritePreview'
import type { HistorySession } from '@/modules/history/store/historyStore'
import { HistoryStatsBar } from '@/screens/main/history/HistoryStatsBar'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

interface RangeStatsBarProps {
  session: HistorySession
  samples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  /** Trimming makes the drag the range; otherwise the chart's zoom window is. */
  trimming: boolean
}

/**
 * Ride stats for the stretch the rider is looking at: the range being trimmed, or the window the
 * chart is zoomed into. Falls back to the ride's own stats when neither is narrowed.
 *
 * Both ranges are read here rather than passed down so a drag frame or a settled pinch re-renders
 * only this bar. Summarising is one pass over the ride's samples — cheap per event, not something
 * to run per frame of a pinch, which is why the zoom arrives already settled.
 */
export function RangeStatsBar({ session, samples, gpsSamples, trimming }: RangeStatsBarProps) {
  const trimRange = useMainScreenStore((s) => s.trimRange)
  const zoomRange = useSettledZoomWindow()
  const range: ChartTimeRange | null = trimming ? trimRange : zoomRange

  const sortedSamples = useMemo(
    () => [...samples].sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [samples],
  )
  const sortedGps = useMemo(
    () => [...gpsSamples].sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [gpsSamples],
  )
  const rangeSession = useMemo<HistorySession>(() => {
    if (!range) return session
    const stats = summarizeFavoriteRange(sortedSamples, sortedGps, range.startMs, range.endMs)
    return {
      ...session,
      startAtMs: range.startMs,
      endAtMs: range.endMs,
      movingStartAtMs: range.startMs,
      movingEndAtMs: range.endMs,
      ...stats,
    }
  }, [range, session, sortedGps, sortedSamples])

  return <HistoryStatsBar session={rangeSession} />
}
