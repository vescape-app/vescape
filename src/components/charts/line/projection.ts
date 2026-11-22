import type { ChartCamera, ChartViewport, ChartYRange } from '@/components/charts/line/types'

export const MIN_SPAN_MS = 20

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

export function viewportFor(
  camera: ChartCamera,
  dataKey: string,
  domainStartMs: number,
  domainEndMs: number,
): ChartViewport {
  'worklet'
  if (camera.key !== dataKey) return { startMs: domainStartMs, endMs: domainEndMs }
  return resolveViewport(camera, domainEndMs, domainStartMs, domainEndMs)
}

export function pickLevel(bucketMs: number[], perPixel: number): number {
  'worklet'
  let picked = -1
  for (let i = 0; i < bucketMs.length; i += 1) {
    if (bucketMs[i] <= perPixel) picked = i
    else break
  }
  return picked
}

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

export function nearestIndex(values: number[], target: number): number {
  'worklet'
  if (values.length === 0) return -1
  const lo = lowerBound(values, target)
  if (lo === 0) return 0
  if (lo >= values.length) return values.length - 1
  const prev = lo - 1
  return target - values[prev] <= values[lo] - target ? prev : lo
}
