export interface TelemetryChartPoint {
  date: Date
  value: number
}

export interface TelemetryChartRange {
  y: { min: number; max: number }
}

export interface ChartAlertMarker {
  value: number
  y: number
}

export interface ExcludedRange {
  startMs: number
  endMs: number
  reason: string
}

export type ChartTimeMode = 'relative' | 'clock'

export function getChartTimeLabels(
  points: TelemetryChartPoint[],
  windowMs: number | undefined,
  mode: ChartTimeMode,
): { start: string; end: string } | null {
  if (points.length < 2) return null
  const now = points[points.length - 1].date
  const start = windowMs ? new Date(now.getTime() - windowMs) : points[0].date
  if (mode === 'clock') {
    return { start: formatClockTime(start), end: formatClockTime(now) }
  }
  const diffMs = now.getTime() - start.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const startLabel = diffSec < 60 ? `-${diffSec}s` : `-${Math.round(diffSec / 60)}m`
  return { start: startLabel, end: 'now' }
}

function formatClockTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

const DEFAULT_GAP_MULTIPLIER = 3

export interface AutoRangeOptions {
  includeZero?: boolean
  minSpan?: number
  paddingRatio?: number
  fallbackMin?: number
  fallbackMax?: number
  baseline?: { min: number; max: number }
}

interface ResolvedRangeOptions {
  includeZero: boolean
  minSpan: number
  paddingRatio: number
  fallbackMin: number
  fallbackMax: number
  baseline: { min: number; max: number } | undefined
}

function resolveRangeOptions(options?: AutoRangeOptions): ResolvedRangeOptions {
  return {
    includeZero: options?.includeZero ?? false,
    minSpan: options?.minSpan ?? 0,
    paddingRatio: options?.paddingRatio ?? 0,
    fallbackMin: options?.fallbackMin ?? options?.baseline?.min ?? -1,
    fallbackMax: options?.fallbackMax ?? options?.baseline?.max ?? 1,
    baseline: options?.baseline,
  }
}

function getMinMax(points: TelemetryChartPoint[], opts: ResolvedRangeOptions) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of points) {
    min = Math.min(min, point.value)
    max = Math.max(max, point.value)
  }

  if (opts.baseline) {
    min = Math.min(min, opts.baseline.min)
    max = Math.max(max, opts.baseline.max)
  }

  if (opts.includeZero) {
    if (min > 0) min = 0
    if (max < 0) max = 0
  }

  const span = Math.max(opts.minSpan, max - min)
  const pad = span * opts.paddingRatio
  return { min: min - pad, max: max + pad }
}

export function computeAutoRange(
  points: TelemetryChartPoint[],
  options?: AutoRangeOptions,
): TelemetryChartRange {
  const opts = resolveRangeOptions(options)
  if (!points.length) return { y: { min: opts.fallbackMin, max: opts.fallbackMax } }
  return { y: getMinMax(points, opts) }
}

export function getChartPosition(
  points: TelemetryChartPoint[],
  point: TelemetryChartPoint,
  range: { y: { min: number; max: number } },
  width: number,
  height: number,
  windowMs?: number,
): { x: number; y: number } | null {
  if (points.length < 2) return null
  const xMax = points[points.length - 1].date.getTime()
  const xMin = windowMs ? xMax - windowMs : points[0].date.getTime()
  const xSpan = xMax - xMin
  const y = getChartYPosition(point.value, range, height)
  if (xSpan <= 0 || y == null) return null

  const x = width * ((point.date.getTime() - xMin) / xSpan)
  return {
    x: Math.max(0, Math.min(width, x)),
    y,
  }
}

/** Map one metric value onto the same inset Y scale used by telemetry points. */
export function getChartYPosition(
  value: number,
  range: { y: { min: number; max: number } },
  height: number,
): number | null {
  const ySpan = range.y.max - range.y.min
  if (!Number.isFinite(value) || ySpan <= 0 || height <= 0) return null

  const inset = 2
  const t = (value - range.y.min) / ySpan
  const y = height - inset - (height - inset * 2) * t
  return Math.max(0, Math.min(height, y))
}

/** Position visible alert lines exactly; omit thresholds outside the chart range. */
export function getChartAlertMarkers(
  values: number[],
  range: { y: { min: number; max: number } },
  height: number,
): ChartAlertMarker[] {
  return [...new Set(values)]
    .filter((value) => value >= range.y.min && value <= range.y.max)
    .map((value) => ({ value, y: getChartYPosition(value, range, height) }))
    .filter((marker): marker is { value: number; y: number } => marker.y != null)
    .sort((a, b) => a.y - b.y)
}

export function getXPosition(
  points: TelemetryChartPoint[],
  timeMs: number,
  width: number,
  windowMs?: number,
): number | null {
  if (points.length < 2) return null
  const xMax = points[points.length - 1].date.getTime()
  const xMin = windowMs ? xMax - windowMs : points[0].date.getTime()
  const xSpan = xMax - xMin
  if (xSpan <= 0) return null
  const x = width * ((timeMs - xMin) / xSpan)
  return Math.max(0, Math.min(width, x))
}

export interface ChartTimeRange {
  startMs: number
  endMs: number
}

export function getChartTimeRangeBands<T extends ChartTimeRange>(
  points: TelemetryChartPoint[],
  ranges: readonly T[],
  width: number,
  windowMs?: number,
): (T & { x: number; width: number })[] {
  if (points.length < 2 || width <= 0) return []
  const domainEndMs = points.at(-1)!.date.getTime()
  const domainStartMs = windowMs ? domainEndMs - windowMs : points[0].date.getTime()

  return ranges.flatMap((range) => {
    const startMs = Math.max(domainStartMs, Math.min(range.startMs, range.endMs))
    const endMs = Math.min(domainEndMs, Math.max(range.startMs, range.endMs))
    if (endMs <= startMs) return []
    const x1 = getXPosition(points, startMs, width, windowMs)
    const x2 = getXPosition(points, endMs, width, windowMs)
    if (x1 == null || x2 == null || x2 <= x1) return []
    return [{ ...range, x: x1, width: x2 - x1 }]
  })
}

export function toExcludedRanges(
  exclusions: {
    startMs: number
    endMs: number
    reason: string
    metrics: Record<string, boolean>
  }[],
  metric: string | string[],
  mergeGapMs = 2000,
): ExcludedRange[] {
  const metrics = Array.isArray(metric) ? metric : [metric]
  const sorted = exclusions
    .filter((e) => metrics.some((m) => e.metrics[m]))
    .sort((a, b) => a.startMs - b.startMs)
  const ranges: ExcludedRange[] = []
  for (const e of sorted) {
    const last = ranges.at(-1)
    if (last && last.reason === e.reason && e.startMs - last.endMs <= mergeGapMs) {
      last.endMs = Math.max(last.endMs, e.endMs)
    } else {
      ranges.push({ startMs: e.startMs, endMs: e.endMs, reason: e.reason })
    }
  }
  return ranges
}

export function findNearestChartPointAtX(
  points: TelemetryChartPoint[],
  x: number,
  width: number,
  windowMs?: number,
): TelemetryChartPoint | null {
  if (points.length === 0 || width <= 0) return null
  const xMax = points[points.length - 1].date.getTime()
  const xMin = windowMs ? xMax - windowMs : points[0].date.getTime()
  const clampedX = Math.max(0, Math.min(width, x))
  const targetMs = xMin + (clampedX / width) * (xMax - xMin)

  let best = points[0]
  let bestDistance = Math.abs(best.date.getTime() - targetMs)
  for (const point of points) {
    const distance = Math.abs(point.date.getTime() - targetMs)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return best
}

function resolveGapThresholdMs(points: TelemetryChartPoint[], gapMultiplier: number): number {
  const deltas: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].date.getTime() - points[i - 1].date.getTime()
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...deltas].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return Math.max(1, median * gapMultiplier)
}

/**
 * Split a series into runs separated by sampling gaps. Runs of a single sample are **kept**: a
 * sparse stretch (every neighbour beyond the gap threshold) is all one-sample runs, and dropping
 * them would render the whole stretch blank while the scrub marker still reports its values.
 * Callers stroke runs of 2+ and draw one-sample runs as dots.
 */
export function splitChartLineSegments(
  points: TelemetryChartPoint[],
  range: { y: { min: number; max: number } },
  width: number,
  height: number,
  windowMs?: number,
  gapMultiplier = DEFAULT_GAP_MULTIPLIER,
): { x: number; y: number }[][] {
  if (points.length === 0 || width <= 0) return []
  const gapThresholdMs = resolveGapThresholdMs(points, gapMultiplier)
  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    const position = getChartPosition(points, point, range, width, height, windowMs)
    if (!position) continue

    if (i > 0) {
      const prev = points[i - 1]
      const deltaMs = point.date.getTime() - prev.date.getTime()
      if (deltaMs > gapThresholdMs && current.length > 0) {
        segments.push(current)
        current = []
      }
    }

    current.push(position)
  }

  if (current.length > 0) segments.push(current)
  return segments
}

export function splitChartPointSegments(
  points: TelemetryChartPoint[],
  range: { y: { min: number; max: number } },
  width: number,
  height: number,
  windowMs?: number,
  gapMultiplier = DEFAULT_GAP_MULTIPLIER,
): { x: number; y: number; point: TelemetryChartPoint }[][] {
  if (points.length === 0 || width <= 0) return []
  const gapThresholdMs = resolveGapThresholdMs(points, gapMultiplier)
  const segments: { x: number; y: number; point: TelemetryChartPoint }[][] = []
  let current: { x: number; y: number; point: TelemetryChartPoint }[] = []

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    const position = getChartPosition(points, point, range, width, height, windowMs)
    if (!position) continue

    if (i > 0) {
      const prev = points[i - 1]
      const deltaMs = point.date.getTime() - prev.date.getTime()
      if (deltaMs > gapThresholdMs && current.length > 0) {
        segments.push(current)
        current = []
      }
    }

    current.push({ ...position, point })
  }

  if (current.length > 0) segments.push(current)
  return segments
}
