/** Em dash used as placeholder when a value is unavailable. */
export const DASH = '—'

const DUTY_IDLE_DEADBAND = 0.01

/** Convert a duty-cycle fraction to display percent, hiding the ±1% idle quantization. */
export function dutyPercent(dutyCycle: number, absolute = true): number {
  if (Math.abs(dutyCycle) <= DUTY_IDLE_DEADBAND) return 0
  const value = dutyCycle * 100
  return absolute ? Math.abs(value) : value
}

/** Format a duty-cycle fraction as a whole percent label. */
export function fmtDutyPercent(dutyCycle: number, absolute = true): string {
  return `${dutyPercent(dutyCycle, absolute).toFixed(0)}%`
}

/** Format voltage: drop trailing .0 (e.g. 84.0 → "84", 3.7 → "3.7"). */
function fmtVoltage(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)
}

/** Format a voltage range: "60–84 V" or "3.2–4.2 V". */
export function fmtVoltageRange(min: number, max: number): string {
  return `${fmtVoltage(min)}–${fmtVoltage(max)} V`
}

/** Format a distance in meters as "240 m" below 1 km, else "1.2 km". */
export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** Format a speed in m/s as a whole km/h label, e.g. "24 km/h". */
export function fmtSpeedKmh(metersPerSecond: number): string {
  return `${Math.round(metersPerSecond * 3.6)} km/h`
}

/** Format a temperature in °C as a whole-degree label, e.g. "64°". */
export function fmtTempC(celsius: number): string {
  return `${Math.round(celsius)}°`
}

/** Format a 0–1 fraction as a whole percent, e.g. "72%". */
export function fmtPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/**
 * Format a ride length in seconds as "8 min", "1 h 20 min" or "< 1 min" — how long something takes,
 * not how long ago it was. Rounds up to the whole minute, because a route that takes forty seconds
 * is a minute of riding and never zero.
 */
export function fmtRideDuration(seconds: number): string {
  const totalMinutes = Math.ceil(Math.max(0, seconds) / 60)
  if (totalMinutes < 1) return '< 1 min'
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/** Format elapsed time since a timestamp, e.g. "5m ago", "2h ago", "3d ago". */
export function fmtTimeAgo(atMs: number, nowMs = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((nowMs - atMs) / 60_000))
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

/**
 * Abbreviate a count so it stays narrow in a fixed-width slot: 999 → "999", 1240 → "1.2k",
 * 100000 → "100k". Backup backlogs run to six figures and must not widen the tile that shows them.
 */
export function fmtCompactCount(value: number): string {
  const n = Math.max(0, Math.round(value))
  if (n < 1000) return String(n)
  // Round before picking the suffix: 999_999 rounds to 1000k, which belongs in the next unit.
  const k = n / 1000
  const roundedK = k < 10 ? Number(k.toFixed(1)) : Math.round(k)
  if (roundedK < 1000) return `${k < 10 ? k.toFixed(1) : roundedK}k`
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}

/** Format bytes to human-readable string (B, KB, MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
