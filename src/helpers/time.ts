import type { DateFormat, TimeFormat } from 'vescape-core'

export type { DateFormat, TimeFormat }

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function pad(value: number): string {
  'worklet'
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `formatHour`
 * @parity /modules/vescape-core/ios/watch/WatchWeather.swift `watchFormatHour`
 */
export function formatTimeOfDay(
  minuteOfDay: number,
  format: TimeFormat = '24h',
  seconds?: number,
): string {
  'worklet'
  const minutes = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440
  const hour = Math.floor(minutes / 60)
  const clock = `${format === '12h' ? hour % 12 || 12 : pad(hour)}:${pad(minutes % 60)}`
  const precise = seconds == null ? clock : `${clock}:${pad(seconds)}`
  return format === '12h' ? `${precise} ${hour < 12 ? 'AM' : 'PM'}` : precise
}

export function formatClock(
  timeMs: number,
  withSeconds = false,
  format: TimeFormat = '24h',
): string {
  'worklet'
  const date = new Date(timeMs)
  return formatTimeOfDay(
    date.getHours() * 60 + date.getMinutes(),
    format,
    withSeconds ? date.getSeconds() : undefined,
  )
}

export function formatDate(input: number | string | Date, format: DateFormat = 'dmy'): string {
  const date = input instanceof Date ? input : new Date(input)
  const day = date.getDate()
  const month = date.getMonth()
  const year = date.getFullYear()
  if (format === 'mdy') return `${SHORT_MONTHS[month]} ${day}, ${year}`
  if (format === 'ymd') return `${year}-${pad(month + 1)}-${pad(day)}`
  return `${day} ${SHORT_MONTHS[month]} ${year}`
}

export function formatShortDate(input: number | string | Date, format: DateFormat = 'dmy'): string {
  const date = input instanceof Date ? input : new Date(input)
  const day = date.getDate()
  const month = date.getMonth()
  if (format === 'mdy') return `${SHORT_MONTHS[month]} ${day}`
  if (format === 'ymd') return `${pad(month + 1)}-${pad(day)}`
  return `${day} ${SHORT_MONTHS[month]}`
}

export function formatDateRange(
  startMs: number,
  endMs: number,
  format: DateFormat = 'dmy',
): string {
  const s = new Date(startMs)
  const e = new Date(endMs)
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()
  if (sameMonth && s.getDate() === e.getDate()) return formatDate(s, format)
  if (format === 'ymd') return `${formatDate(s, 'ymd')} – ${formatDate(e, 'ymd')}`
  if (sameMonth) {
    return format === 'mdy'
      ? `${SHORT_MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
      : `${s.getDate()}–${e.getDate()} ${SHORT_MONTHS[s.getMonth()]} ${s.getFullYear()}`
  }
  return format === 'mdy'
    ? `${SHORT_MONTHS[s.getMonth()]} ${s.getDate()} – ${SHORT_MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`
    : `${s.getDate()} ${SHORT_MONTHS[s.getMonth()]} – ${e.getDate()} ${SHORT_MONTHS[e.getMonth()]} ${e.getFullYear()}`
}

export function formatDateTime(
  timeMs: number,
  timeFormat: TimeFormat = '24h',
  dateFormat: DateFormat = 'dmy',
): string {
  return `${formatDate(timeMs, dateFormat)} ${formatClock(timeMs, true, timeFormat)}`
}
