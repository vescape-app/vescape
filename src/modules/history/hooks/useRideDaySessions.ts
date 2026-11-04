import { getRideHistoryPage, type RideDay } from 'vescape-core'

import { calendarDayKey } from '@/helpers/calendarDay'
import { useAsyncRead } from '@/hooks/useAsyncRead'
import { rideDayBounds } from '@/modules/history/lib/rideDay'
import type { HistorySession } from '@/modules/history/lib/sessions'

const DAY_PAGE_SIZE = 50
const DAY_MS = 24 * 60 * 60_000
const NO_SESSIONS: HistorySession[] = []

/**
 * The rides that started on `day`, newest first: the same rule native applies to that day's stats.
 * Paging starts a day past it so a ride running over midnight is read whole, not cut at the cursor.
 */
export function useRideDaySessions(day: RideDay) {
  return useAsyncRead(() => readDay(rideDayBounds(day)), NO_SESSIONS, calendarDayKey(day))
}

async function readDay({ startMs, endMs }: { startMs: number; endMs: number }) {
  const rides: HistorySession[] = []
  let cursorBeforeMs: number | undefined = endMs + DAY_MS
  while (cursorBeforeMs != null) {
    const page = await getRideHistoryPage({ cursorBeforeMs, limit: DAY_PAGE_SIZE })
    rides.push(...page.sessions.filter((s) => s.startAtMs >= startMs && s.startAtMs < endMs))
    const oldest = page.sessions.at(-1)
    cursorBeforeMs =
      page.hasMore && oldest && oldest.startAtMs >= startMs
        ? (page.nextCursorBeforeMs ?? undefined)
        : undefined
  }
  return rides
}
