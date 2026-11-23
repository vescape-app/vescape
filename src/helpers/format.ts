export const DASH = '—'

const DUTY_IDLE_DEADBAND = 0.01

export function dutyPercent(dutyCycle: number, absolute = true): number {
  if (Math.abs(dutyCycle) <= DUTY_IDLE_DEADBAND) return 0
  const value = dutyCycle * 100
  return absolute ? Math.abs(value) : value
}

export function fmtDutyPercent(dutyCycle: number, absolute = true): string {
  return `${dutyPercent(dutyCycle, absolute).toFixed(0)}%`
}

function fmtVoltage(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)
}

export function fmtVoltageRange(min: number, max: number): string {
  return `${fmtVoltage(min)}–${fmtVoltage(max)} V`
}

export function fmtPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function fmtRideDuration(seconds: number): string {
  const totalMinutes = Math.ceil(Math.max(0, seconds) / 60)
  if (totalMinutes < 1) return '< 1 min'
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

export function fmtTimeAgo(atMs: number, nowMs = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((nowMs - atMs) / 60_000))
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

export function fmtCompactCount(value: number): string {
  const n = Math.max(0, Math.round(value))
  if (n < 1000) return String(n)
  const k = n / 1000
  const roundedK = k < 10 ? Number(k.toFixed(1)) : Math.round(k)
  if (roundedK < 1000) return `${k < 10 ? k.toFixed(1) : roundedK}k`
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
