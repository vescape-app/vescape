/** Axis ticks are read at a glance, so they drop decimals as soon as the scale allows. */
export function formatAxisNumber(value: number): string {
  'worklet'
  const magnitude = Math.abs(value)
  if (magnitude >= 100 || Number.isInteger(value)) return Math.round(value).toString()
  return value.toFixed(1)
}

function pad(value: number): string {
  'worklet'
  return value < 10 ? `0${value}` : `${value}`
}

/** Wall-clock label. Seconds appear only once the window is short enough for them to move. */
export function formatClock(timeMs: number, withSeconds: boolean): string {
  'worklet'
  const date = new Date(timeMs)
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base
}

/** Offset from the live head, for charts whose right edge is always "now". */
export function formatRelative(offsetMs: number): string {
  'worklet'
  const seconds = Math.round(offsetMs / 1000)
  if (seconds <= 0) return 'now'
  if (seconds < 60) return `-${seconds}s`
  if (seconds < 3600) return `-${Math.round(seconds / 60)}m`
  return `-${(seconds / 3600).toFixed(1)}h`
}
