import type { TimeFormat } from 'vescape-core'

export type { TimeFormat }

function pad(value: number): string {
  'worklet'
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * Forecast minutes belong to the forecast location, not the device timezone.
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

/** Worklet-safe local wall clock, shared by React and Skia charts. */
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

export function formatDateTime(timeMs: number, format: TimeFormat = '24h'): string {
  return `${new Date(timeMs).toLocaleDateString()} ${formatClock(timeMs, true, format)}`
}
