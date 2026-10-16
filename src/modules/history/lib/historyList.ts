import { formatRideDate } from '@/modules/history/lib/rideFormat'
import { rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

/** Calendar sections follow the displayed ride start, including legacy rides and appended pages. */
export function historyListRows<
  T extends Pick<HistorySession, 'startAtMs' | 'endAtMs' | 'movingStartAtMs' | 'movingEndAtMs'>,
>(sessions: T[]) {
  let previousDate: string | null = null
  return sessions.map((session) => {
    const window = rideMovingWindow(session) ?? {
      startMs: session.startAtMs,
      endMs: session.endAtMs,
    }
    const date = formatRideDate(window.startMs, window.startMs)
    const dateHeader = date !== previousDate ? date : null
    previousDate = date
    return { session, window, dateHeader }
  })
}
