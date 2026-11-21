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

const NICE_STEPS = [1, 2, 2.5, 5, 10]

function niceStep(target: number): number {
  if (!(target > 0)) return 1
  const decade = 10 ** Math.floor(Math.log10(target))
  let step = decade
  for (const candidate of NICE_STEPS) {
    if (candidate * decade <= target) step = candidate * decade
  }
  return step
}

function snapRange(min: number, max: number) {
  const step = niceStep((max - min) / 4)
  const snappedMin = Math.floor(min / step) * step
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

  const span = Math.max(opts.minSpan, high - low) * (1 + opts.paddingRatio * 2)
  const center = (low + high) / 2
  let min = center - span / 2
  let max = center + span / 2

  if (opts.includeZero && rawMin >= 0) {
    min = 0
    max = Math.max(max, span)
  } else if (opts.includeZero && rawMax <= 0) {
    max = 0
    min = Math.min(min, -span)
  }

  if (opts.snap) ({ min, max } = snapRange(min, max))

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
