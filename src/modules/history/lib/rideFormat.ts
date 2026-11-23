import { formatClock, formatDateRange, type DateFormat, type TimeFormat } from '@/helpers/time'
import { formatRideDistanceMeters, type DistanceUnit } from '@/helpers/units'

export function formatRideTime(
  startMs: number,
  endMs: number,
  live = false,
  timeFormat: TimeFormat = '24h',
): string {
  return `${formatClock(startMs, false, timeFormat)} – ${live ? 'now' : formatClock(endMs, false, timeFormat)}`
}

export function formatRideDate(
  startMs: number,
  endMs: number,
  dateFormat: DateFormat = 'dmy',
): string {
  return formatDateRange(startMs, endMs, dateFormat)
}

export function formatRideMeta(
  startAtMs: number,
  endAtMs: number,
  boardName: string,
  dateFormat: DateFormat = 'dmy',
): string {
  const date = formatRideDate(startAtMs, endAtMs, dateFormat)
  return boardName ? `${date} · ${boardName}` : date
}

export function formatRideListDetails(
  durationMs: number,
  distanceM: number | null,
  distanceUnit: DistanceUnit = 'km',
): string {
  return [
    formatRideListDuration(durationMs),
    distanceM == null ? null : formatRideDistanceMeters(distanceM, distanceUnit, 2),
  ]
    .filter((part): part is string => part != null)
    .join(' · ')
}

export function formatFavoriteName(name: string | null, startMs: number, endMs: number): string {
  return name?.trim() || suggestFavoriteName(startMs, endMs)
}

export function suggestFavoriteName(startMs: number, endMs: number): string {
  const start = Math.min(startMs, endMs)
  const durationHours = Math.abs(endMs - startMs) / 3_600_000
  if (durationHours >= 36) return 'Multi-day ride'
  if (durationHours >= 18) return 'All-day ride'
  if (durationHours >= 12) return 'Day ride'

  const hour = new Date(start).getHours()
  if (hour >= 4 && hour < 12) return 'Morning ride'
  if (hour >= 12 && hour < 17) return 'Afternoon ride'
  if (hour >= 17 && hour < 22) return 'Evening ride'
  return 'Night ride'
}

function formatRideListDuration(durationMs: number): string {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000))
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}
