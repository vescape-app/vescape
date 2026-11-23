import type { DateFormat, TimeFormat } from 'vescape-core'
import { DASH } from '@/helpers/format'

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

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: 'DD Mon',
  mdy: 'Mon DD',
  'dmy-slash': 'DD/MM',
  'mdy-slash': 'MM/DD',
  'dmy-dot': 'DD.MM',
  ymd: 'ISO',
}

export function dateFormatLabel(format: DateFormat): string {
  return DATE_FORMAT_LABELS[format]
}

export function formatDate(input: number | string | Date, format: DateFormat = 'dmy'): string {
  const date = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(date.getTime())) return DASH
  const day = date.getDate()
  const month = date.getMonth()
  const year = date.getFullYear()
  switch (format) {
    case 'mdy':
      return `${SHORT_MONTHS[month]} ${day}, ${year}`
    case 'dmy-slash':
      return `${pad(day)}/${pad(month + 1)}/${year}`
    case 'mdy-slash':
      return `${pad(month + 1)}/${pad(day)}/${year}`
    case 'dmy-dot':
      return `${pad(day)}.${pad(month + 1)}.${year}`
    case 'ymd':
      return `${year}-${pad(month + 1)}-${pad(day)}`
    case 'dmy':
      return `${day} ${SHORT_MONTHS[month]} ${year}`
  }
}

export function formatShortDate(input: number | string | Date, format: DateFormat = 'dmy'): string {
  const date = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(date.getTime())) return DASH
  const day = date.getDate()
  const month = date.getMonth()
  switch (format) {
    case 'mdy':
      return `${SHORT_MONTHS[month]} ${day}`
    case 'dmy-slash':
      return `${pad(day)}/${pad(month + 1)}`
    case 'mdy-slash':
      return `${pad(month + 1)}/${pad(day)}`
    case 'dmy-dot':
      return `${pad(day)}.${pad(month + 1)}`
    case 'ymd':
      return `${pad(month + 1)}-${pad(day)}`
    case 'dmy':
      return `${day} ${SHORT_MONTHS[month]}`
  }
}

export function formatDateRange(
  startMs: number,
  endMs: number,
  format: DateFormat = 'dmy',
): string {
  const s = new Date(startMs)
  const e = new Date(endMs)
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return DASH
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()
  if (sameMonth && s.getDate() === e.getDate()) return formatDate(s, format)
  if (!sameYear || (format !== 'dmy' && format !== 'mdy')) {
    return `${formatDate(s, format)} – ${formatDate(e, format)}`
  }
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
  if (!Number.isFinite(new Date(timeMs).getTime())) return DASH
  return `${formatDate(timeMs, dateFormat)} ${formatClock(timeMs, true, timeFormat)}`
}
