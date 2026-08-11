import { useMemo } from 'react'
import type { HistoryGpsSample, TelemetrySample } from 'vescape-core'

import { summarizeFavoriteRange } from '@/modules/history/lib/favoritePreview'
import type { HistorySession } from '@/modules/history/store/historyStore'
import { HistoryStatsBar } from '@/screens/main/history/HistoryStatsBar'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

interface TrimStatsBarProps {
  session: HistorySession
  samples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
}

/**
 * Ride stats recomputed live for the range being trimmed. Subscribes to the trim range directly so
 * each drag frame re-renders only this bar. Reuses the history stats bar by spreading a preview
 * summary over the open session; before any drag it shows the ride's own stats.
 */
export function TrimStatsBar({ session, samples, gpsSamples }: TrimStatsBarProps) {
  const trimRange = useMainScreenStore((s) => s.trimRange)
  const sortedSamples = useMemo(
    () => [...samples].sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [samples],
  )
  const sortedGps = useMemo(
    () => [...gpsSamples].sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [gpsSamples],
  )
  const previewSession = useMemo<HistorySession>(() => {
    if (!trimRange) return session
    const stats = summarizeFavoriteRange(
      sortedSamples,
      sortedGps,
      trimRange.startMs,
      trimRange.endMs,
    )
    return {
      ...session,
      startAtMs: trimRange.startMs,
      endAtMs: trimRange.endMs,
      movingStartAtMs: trimRange.startMs,
      movingEndAtMs: trimRange.endMs,
      ...stats,
    }
  }, [session, sortedSamples, sortedGps, trimRange])

  return <HistoryStatsBar session={previewSession} />
}
