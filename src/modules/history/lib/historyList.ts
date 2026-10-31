import { formatRideDate } from '@/modules/history/lib/rideFormat'
import { rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

/** Calendar sections follow the displayed ride start, including legacy rides and appended pages. */
export function historyListRows<
  T extends Pick<
    HistorySession,
    'startAtMs' | 'endAtMs' | 'movingStartAtMs' | 'movingEndAtMs' | 'distanceM'
  >,
>(sessions: T[]) {
  let previousDate: string | null = null
  let day: HistoryListDay | null = null
  return sessions.map((session) => {
    const window = rideMovingWindow(session) ?? {
      startMs: session.startAtMs,
      endMs: session.endAtMs,
    }
    const date = formatRideDate(window.startMs, window.startMs)
    const dateHeader = date !== previousDate ? date : null
    previousDate = date
    if (dateHeader) day = { rides: 0, durationMs: 0, distanceM: null }
    // Rows share their heading's totals object, so later rows of the day add to it in place.
    day!.rides += 1
    day!.durationMs += window.endMs - window.startMs
    if (session.distanceM != null) day!.distanceM = (day!.distanceM ?? 0) + session.distanceM
    return { session, window, dateHeader, day: dateHeader ? day! : null }
  })
}

/** Totals of the loaded rides under one date heading; a day split across pages grows as they load. */
export interface HistoryListDay {
  rides: number
  durationMs: number
  distanceM: number | null
}

export const HISTORY_RIDE_ROW_HEIGHT = 88
export const HISTORY_RIDE_ROW_GAP = 8

/** Exact FlatList frames; date headings belong to the following row, not separate data items. */
export function historyListLayouts(
  rows: readonly { dateHeader: string | null }[],
  dateHeaderHeight: number,
) {
  let offset = 0
  return rows.map(({ dateHeader }, index) => {
    const headingHeight = dateHeader ? dateHeaderHeight : 0
    const length = headingHeight + HISTORY_RIDE_ROW_HEIGHT
    const layout = { index, offset, length, rowOffset: offset + headingHeight }
    offset += length + HISTORY_RIDE_ROW_GAP
    return layout
  })
}
