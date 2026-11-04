import type { RideDay } from 'vescape-core'

import { formatRideDate } from '@/modules/history/lib/rideFormat'

/** The local calendar day an instant falls on. */
export function rideDayOf(atMs: number): RideDay {
  const date = new Date(atMs)
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

/** Local midnight opening `day`, and the next one. */
export function rideDayBounds({ year, month, day }: RideDay): { startMs: number; endMs: number } {
  return {
    startMs: new Date(year, month - 1, day).getTime(),
    endMs: new Date(year, month - 1, day + 1).getTime(),
  }
}

export function formatRideDay(day: RideDay): string {
  const { startMs } = rideDayBounds(day)
  return formatRideDate(startMs, startMs)
}
