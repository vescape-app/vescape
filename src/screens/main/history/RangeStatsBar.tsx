import { RodeWithRow } from '@/modules/group-ride/components/RodeWith'
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
  trimming: boolean
}

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
      weather: null,
      ...stats,
    }
  }, [range, session, sortedGps, sortedSamples])

  return (
    <HistoryStatsBar session={rangeSession}>
      <RodeWithRow />
    </HistoryStatsBar>
  )
}
