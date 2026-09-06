export interface ExcludedRange {
  startMs: number
  endMs: number
  reason: string
}

export interface AutoRangeOptions {
  includeZero?: boolean
  minSpan?: number
  paddingRatio?: number
  fallbackMin?: number
  fallbackMax?: number
  baseline?: { min: number; max: number }
  /** Snap the bounds outward to round numbers, so the axis reads 0/35/70 rather than -11.6/25.7/63.1. */
  snap?: boolean
}

interface ResolvedRangeOptions {
  includeZero: boolean
  minSpan: number
  paddingRatio: number
  fallbackMin: number
  fallbackMax: number
  baseline: { min: number; max: number } | undefined
  snap: boolean
}

function resolveRangeOptions(options?: AutoRangeOptions): ResolvedRangeOptions {
  return {
    includeZero: options?.includeZero ?? false,
    minSpan: options?.minSpan ?? 0,
    paddingRatio: options?.paddingRatio ?? 0,
    fallbackMin: options?.fallbackMin ?? options?.baseline?.min ?? -1,
    fallbackMax: options?.fallbackMax ?? options?.baseline?.max ?? 1,
    baseline: options?.baseline,
    snap: options?.snap ?? false,
  }
}

/** 1, 2, 5 and their decades — the steps a reader can do arithmetic on without thinking. */
const NICE_STEPS = [1, 2, 2.5, 5, 10]

/** The largest round step no bigger than `target`, so a span of it divides into legible gridlines. */
function niceStep(target: number): number {
  if (!(target > 0)) return 1
  const decade = 10 ** Math.floor(Math.log10(target))
  let step = decade
  for (const candidate of NICE_STEPS) {
    if (candidate * decade <= target) step = candidate * decade
  }
  return step
}

/**
 * Widen a range outward to round bounds.
 *
 * A step of roughly a quarter of the span keeps the snap tight — the axis gains a little headroom,
 * not a whole decade. Without it a padded auto-range prints whatever the ride's noisiest sample
 * happened to be, and a rider reading `63.1` learns nothing they could not read off the line.
 */
function snapRange(min: number, max: number) {
  const step = niceStep((max - min) / 4)
  const snappedMin = Math.floor(min / step) * step
  // Counted in steps rather than accumulated, to keep float dust out of the labels.
  const steps = Math.ceil((max - snappedMin) / step)
  return { min: snappedMin, max: snappedMin + steps * step }
}

function padRange(rawMin: number, rawMax: number, opts: ResolvedRangeOptions) {
  let low = rawMin
  let high = rawMax
  if (opts.includeZero) {
    low = Math.min(low, 0)
    high = Math.max(high, 0)
  }

  // Grow to `minSpan` around the middle, so a flat ride is not drawn as a mountain range.
  const span = Math.max(opts.minSpan, high - low) * (1 + opts.paddingRatio * 2)
  const center = (low + high) / 2
  let min = center - span / 2
  let max = center + span / 2

  // Padding must not push the axis across a zero the ride never crossed: a speed floor of -11.6
  // km/h is not a reading, it is arithmetic leaking into the label.
  if (opts.includeZero && rawMin >= 0) {
    min = 0
    max = Math.max(max, span)
  } else if (opts.includeZero && rawMax <= 0) {
    max = 0
    min = Math.min(min, -span)
  }

  if (opts.snap) ({ min, max } = snapRange(min, max))

  // A baseline is the domain the metric is read against — 0-100% duty, 0-50 km/h — so it wins on
  // either side the ride stayed inside of. Padding a bound the rider knows by heart into 41.6
  // tells them nothing; only an actual overshoot is worth redrawing the axis for.
  if (opts.baseline) {
    if (rawMin >= opts.baseline.min) min = opts.baseline.min
    if (rawMax <= opts.baseline.max) max = opts.baseline.max
  }

  return { min, max }
}

export function computeAutoRangeFromValues(
  values: number[],
  options?: AutoRangeOptions,
): { min: number; max: number } {
  const opts = resolveRangeOptions(options)
  if (values.length === 0) return { min: opts.fallbackMin, max: opts.fallbackMax }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return padRange(min, max, opts)
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
