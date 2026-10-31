/** A local calendar day; `month` is 1-based. Structurally the same as vescape-core's `RideDay`. */
interface CalendarDay {
  year: number
  month: number
  day: number
}

/** `YYYY-M-D`: the day's identity in route params and cache keys. */
export function calendarDayKey({ year, month, day }: CalendarDay): string {
  return `${year}-${month}-${day}`
}
