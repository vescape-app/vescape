export function formatAxisNumber(value: number): string {
  'worklet'
  const magnitude = Math.abs(value)
  if (magnitude >= 100 || Number.isInteger(value)) return Math.round(value).toString()
  return value.toFixed(1)
}

export function formatRelative(offsetMs: number): string {
  'worklet'
  const seconds = Math.round(offsetMs / 1000)
  if (seconds <= 0) return 'now'
  if (seconds < 60) return `-${seconds}s`
  if (seconds < 3600) return `-${Math.round(seconds / 60)}m`
  return `-${(seconds / 3600).toFixed(1)}h`
}
