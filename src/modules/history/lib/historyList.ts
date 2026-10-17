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
