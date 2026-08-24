export function formatRideTime(startMs: number, endMs: number, live = false): string {
  const start = new Date(startMs)
  const end = new Date(endMs)
  const h = (d: Date) => d.getHours().toString().padStart(2, '0')
  const m = (d: Date) => d.getMinutes().toString().padStart(2, '0')
  return `${h(start)}:${m(start)} – ${live ? 'now' : `${h(end)}:${m(end)}`}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatRideDate(startMs: number, endMs: number): string {
  const s = new Date(startMs)
  const e = new Date(endMs)
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate()
  if (sameDay) {
    return `${s.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`
  }
  return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`
}

export function formatRideMeta(startAtMs: number, endAtMs: number, deviceName: string): string {
  return deviceName
    ? `${formatRideDate(startAtMs, endAtMs)} · ${deviceName}`
    : formatRideDate(startAtMs, endAtMs)
}

export function formatRideListDateTime(startAtMs: number, endAtMs: number, live = false): string {
  return `${formatRideTime(startAtMs, endAtMs, live)} · ${formatRideDate(startAtMs, endAtMs)}`
}

export function formatRideListDetails(
  durationMs: number,
  distanceM: number | null,
  deviceName: string | null,
): string {
  return [
    formatRideListDuration(durationMs),
    distanceM == null ? null : `${(distanceM / 1000).toFixed(2)} km`,
    deviceName?.trim() || null,
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
