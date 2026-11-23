import type { PublicRideStatus } from 'vescape-core'

import { formatClock, formatShortDate, type DateFormat, type TimeFormat } from '@/helpers/time'

export const PUBLIC_RIDE_DURATIONS = [1, 2, 3, 4, 6, 8, 10, 12, 24, 48, 72, 96, 120, 144, 168]

const HOUR_MS = 3_600_000

export type PublicRideChoice =
  { mode: 'off' } | { mode: 'always' } | { mode: 'hours'; hours: number }

export function publicRideDurationLabel(hours: number) {
  return hours >= 48 ? `${hours / 24} d` : `${hours} h`
}

export function publicRideUntil(choice: PublicRideChoice, now: number): number | null {
  return choice.mode === 'hours' ? now + choice.hours * HOUR_MS : null
}

export function publicRideChoice(status: PublicRideStatus, now: number): PublicRideChoice {
  if (status.activation === 'off') return { mode: 'off' }
  if (status.until == null) return { mode: 'always' }
  const left = (status.until - now) / HOUR_MS
  const hours =
    PUBLIC_RIDE_DURATIONS.find((duration) => duration >= left - 1 / 60) ??
    PUBLIC_RIDE_DURATIONS[PUBLIC_RIDE_DURATIONS.length - 1]
  return { mode: 'hours', hours }
}

const MINUTE_MS = 60_000

export function publicRideTimeLeft(until: number | null, now: number): string | null {
  if (until == null || until <= now) return null
  const minutes = Math.ceil((until - now) / MINUTE_MS)
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} m` : `${hours} h`
  return `${mins} m`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

export function publicRideEndLabel(
  until: number,
  now: number,
  format: TimeFormat,
  dateFormat: DateFormat = 'dmy',
): string {
  const clock = formatClock(until, false, format)
  const end = new Date(until)
  const days = Math.round(
    (new Date(end).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS,
  )
  if (days <= 0) return clock
  if (days === 1) return `tomorrow ${clock}`
  if (days < 7) return `${WEEKDAYS[end.getDay()]} ${clock}`
  return `${formatShortDate(end, dateFormat)} ${clock}`
}

export function publicRidePresetEnds(
  now: number,
  format: TimeFormat,
  dateFormat: DateFormat = 'dmy',
): string[] {
  return PUBLIC_RIDE_DURATIONS.map((hours) =>
    publicRideEndLabel(now + hours * HOUR_MS, now, format, dateFormat),
  )
}
