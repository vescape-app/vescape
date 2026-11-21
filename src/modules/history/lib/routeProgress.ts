import { distanceMeters } from '@/helpers/mapGeometry'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

export function routeDistanceProgress(samples: readonly HistoryGpsSample[]): number[] {
  const distances = new Array<number>(samples.length).fill(0)
  let distanceM = 0
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]
    const to = samples[index]
    distanceM += distanceMeters(
      { longitude: from.longitude, latitude: from.latitude },
      { longitude: to.longitude, latitude: to.latitude },
    )
    distances[index] = distanceM
  }

  if (distanceM <= 0) return distances
  return distances.map((distance) => Math.max(0, Math.min(1, distance / distanceM)))
}

export interface RouteTimeProgress {
  ts: number[]
  at: number[]
}

export function routeTimeProgress(samples: readonly HistoryGpsSample[]): RouteTimeProgress {
  return {
    ts: samples.map((sample) => sample.capturedAtMs),
    at: routeDistanceProgress(samples),
  }
}

export function progressAtTime(timeMs: number, { ts, at }: RouteTimeProgress): number {
  if (ts.length === 0) return 0
  if (timeMs <= ts[0]) return 0
  if (timeMs >= ts[ts.length - 1]) return 1
  let lo = 0
  let hi = ts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ts[mid] < timeMs) lo = mid + 1
    else hi = mid
  }
  const span = ts[lo] - ts[lo - 1]
  const ratio = span > 0 ? (timeMs - ts[lo - 1]) / span : 0
  return at[lo - 1] + (at[lo] - at[lo - 1]) * ratio
}
