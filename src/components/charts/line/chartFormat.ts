/** Axis ticks are read at a glance, so they drop decimals as soon as the scale allows. */
export function formatAxisNumber(value: number): string {
  'worklet'
  const magnitude = Math.abs(value)
  if (magnitude >= 100 || Number.isInteger(value)) return Math.round(value).toString()
  return value.toFixed(1)
}

/**
 * How a reading is printed, as data rather than as a formatter.
 *
 * The head reading is redrawn on the UI thread for every frame of a scrub, and a formatter
 * defined on the JS side cannot be called from there. Carrying the few decisions that formatting
 * makes — precision, unit, sign — lets the same rules run in a worklet.
 */
export interface ChartNumberFormat {
  decimals: number
  unit?: string
  /** No separator between the number and its unit, as in `52.1V`. */
  compactUnit?: boolean
  /** Print the magnitude; for metrics whose sign is an artefact of wiring, not of riding. */
  abs?: boolean
}

export function formatReading(value: number, format: ChartNumberFormat): string {
  'worklet'
  const magnitude = format.abs ? Math.abs(value) : value
  const number =
    format.decimals === 0 ? Math.round(magnitude).toString() : magnitude.toFixed(format.decimals)
  if (!format.unit) return number
  return format.compactUnit ? `${number}${format.unit}` : `${number} ${format.unit}`
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
