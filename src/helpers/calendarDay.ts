interface CalendarDay {
  year: number
  month: number
  day: number
}

export function calendarDayKey({ year, month, day }: CalendarDay): string {
  return `${year}-${month}-${day}`
}
