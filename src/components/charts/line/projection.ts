import type { ChartCamera, ChartViewport, ChartYRange } from '@/components/charts/line/types'

/**
 * Tightest window the camera will resolve — one focused-series bucket. Zoom is otherwise
 * unlimited: past the raw sample density the chart draws individual points rather than
 * refusing to go further.
 */
export const MIN_SPAN_MS = 20

/** Keeps the extremes of the range off the exact edge of the plot so a peak stays visible. */
const Y_INSET = 2

export function msPerPixel(viewport: ChartViewport, width: number): number {
  'worklet'
  if (width <= 0) return Number.POSITIVE_INFINITY
  return (viewport.endMs - viewport.startMs) / width
}

export function projectX(timeMs: number, viewport: ChartViewport, width: number): number {
  'worklet'
  const span = viewport.endMs - viewport.startMs
  if (span <= 0) return 0
  return ((timeMs - viewport.startMs) / span) * width
}

export function unprojectX(x: number, viewport: ChartViewport, width: number): number {
  'worklet'
  if (width <= 0) return viewport.startMs
  return viewport.startMs + (x / width) * (viewport.endMs - viewport.startMs)
}

export function projectY(value: number, range: ChartYRange, height: number): number {
  'worklet'
  const span = range.max - range.min
  if (span <= 0 || height <= 0) return height / 2
  const t = (value - range.min) / span
  return height - Y_INSET - (height - Y_INSET * 2) * t
}

/**
 * The viewport as a 3x3 matrix mapping data space — seconds from the domain start, metric
 * units — onto the plot.
 *
 * Both axes are affine, so the whole projection is one matrix. That is what lets a zoom frame
 * transform a finished path instead of reprojecting every point in JavaScript: the per-frame
 * cost stops depending on how many samples the ride has.
 */
export function viewportMatrix(
  viewport: ChartViewport,
  domainStartMs: number,
  range: ChartYRange,
  width: number,
  height: number,
): number[] {
  'worklet'
  const spanSeconds = (viewport.endMs - viewport.startMs) / 1000
  const scaleX = spanSeconds > 0 ? width / spanSeconds : 0
  const translateX = -((viewport.startMs - domainStartMs) / 1000) * scaleX

  const valueSpan = range.max - range.min
  const usable = height - Y_INSET * 2
  const scaleY = valueSpan > 0 ? -usable / valueSpan : 0
  const translateY =
    valueSpan > 0 ? height - Y_INSET + (usable * range.min) / valueSpan : height / 2

  return [scaleX, 0, translateX, 0, scaleY, translateY, 0, 0, 1]
}

/**
 * Resolve the camera against the data domain. A camera following the live head keeps its
 * span and rides `headMs`; a detached one is clamped so panning cannot leave the data.
 */
export function resolveViewport(
  camera: ChartCamera,
  headMs: number,
  domainStartMs: number,
  domainEndMs: number,
): ChartViewport {
  'worklet'
  const domainSpan = Math.max(domainEndMs - domainStartMs, MIN_SPAN_MS)
  const span = Math.max(MIN_SPAN_MS, Math.min(camera.spanMs, domainSpan))
  if (camera.endMs == null) {
    return { startMs: headMs - span, endMs: headMs }
  }
  const end = Math.max(domainStartMs + span, Math.min(camera.endMs, domainEndMs))
  return { startMs: end - span, endMs: end }
}

/**
 * The viewport a given dataset should be drawn through.
 *
 * Every worklet that projects data calls this for itself rather than reading a viewport
 * computed elsewhere. Reanimated schedules each derived value independently, so a shared
 * viewport can reach the screen a frame before the paths it belongs to — which looks like the
 * previous dataset flashing, squashed, before the new one appears. Resolving here keeps the
 * camera and the data that answers to it inside one worklet.
 *
 * Defined after `resolveViewport` on purpose: a worklet captures the functions it calls where
 * it is written, so calling one declared further down the file finds nothing at run time.
 */
export function viewportFor(
  camera: ChartCamera,
  dataKey: string,
  domainStartMs: number,
  domainEndMs: number,
): ChartViewport {
  'worklet'
  // An untouched camera, or one aimed at data the rider has since navigated away from, shows
  // everything there is.
  if (camera.key !== dataKey) return { startMs: domainStartMs, endMs: domainEndMs }
  return resolveViewport(camera, domainEndMs, domainStartMs, domainEndMs)
}

/**
 * Coarsest level whose buckets stay under one pixel, or `-1` for the raw samples. Takes the
 * bucket widths alone rather than the pyramid, so the UI thread never holds the sample data.
 */
export function pickLevel(bucketMs: number[], perPixel: number): number {
  'worklet'
  let picked = -1
  for (let i = 0; i < bucketMs.length; i += 1) {
    if (bucketMs[i] <= perPixel) picked = i
    else break
  }
  return picked
}

/** First index whose value is `>= target`, or `length` when every value is smaller. */
export function lowerBound(values: number[], target: number): number {
  'worklet'
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the value closest to `target`, or `-1` for an empty array. */
export function nearestIndex(values: number[], target: number): number {
  'worklet'
  if (values.length === 0) return -1
  const lo = lowerBound(values, target)
  if (lo === 0) return 0
  if (lo >= values.length) return values.length - 1
  const prev = lo - 1
  return target - values[prev] <= values[lo] - target ? prev : lo
}
