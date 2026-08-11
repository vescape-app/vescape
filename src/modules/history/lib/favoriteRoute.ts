import type { HistoryGpsSample } from 'vescape-core'

export interface FavoriteTimeRange {
  startMs: number
  endMs: number
}

type Coordinate = [longitude: number, latitude: number]

function interpolateCoordinate(
  from: HistoryGpsSample,
  to: HistoryGpsSample,
  capturedAtMs: number,
): Coordinate {
  const spanMs = to.capturedAtMs - from.capturedAtMs
  if (spanMs <= 0) return [from.longitude, from.latitude]
  const progress = Math.max(0, Math.min(1, (capturedAtMs - from.capturedAtMs) / spanMs))
  return [
    from.longitude + (to.longitude - from.longitude) * progress,
    from.latitude + (to.latitude - from.latitude) * progress,
  ]
}

function appendCoordinate(coordinates: Coordinate[], coordinate: Coordinate) {
  const previous = coordinates.at(-1)
  if (previous?.[0] === coordinate[0] && previous[1] === coordinate[1]) return
  coordinates.push(coordinate)
}

function mergeRanges(ranges: readonly FavoriteTimeRange[]): FavoriteTimeRange[] {
  const sorted = ranges
    .map(({ startMs, endMs }) => ({
      startMs: Math.min(startMs, endMs),
      endMs: Math.max(startMs, endMs),
    }))
    .sort((a, b) => a.startMs - b.startMs)

  const merged: FavoriteTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (!previous || range.startMs > previous.endMs) {
      merged.push(range)
    } else {
      previous.endMs = Math.max(previous.endMs, range.endMs)
    }
  }
  return merged
}

/**
 * Clip the selected ride's GPS polyline to the union of its Favorite ranges. Boundary coordinates
 * are time-interpolated so a short Favorite remains visible even when neither edge lands exactly on
 * a persisted GPS sample. `gpsSamples` must be sorted ascending by `capturedAtMs`.
 */
export function getFavoriteRouteSegments(
  gpsSamples: readonly HistoryGpsSample[],
  favoriteRanges: readonly FavoriteTimeRange[],
): Coordinate[][] {
  if (gpsSamples.length < 2 || favoriteRanges.length === 0) return []

  const segments: Coordinate[][] = []
  for (const range of mergeRanges(favoriteRanges)) {
    const coordinates: Coordinate[] = []
    for (let index = 0; index < gpsSamples.length - 1; index += 1) {
      const from = gpsSamples[index]
      const to = gpsSamples[index + 1]
      if (to.capturedAtMs < range.startMs) continue
      if (from.capturedAtMs > range.endMs) break

      const overlapStartMs = Math.max(from.capturedAtMs, range.startMs)
      const overlapEndMs = Math.min(to.capturedAtMs, range.endMs)
      if (overlapEndMs < overlapStartMs) continue

      appendCoordinate(coordinates, interpolateCoordinate(from, to, overlapStartMs))
      appendCoordinate(coordinates, interpolateCoordinate(from, to, overlapEndMs))
    }
    if (coordinates.length >= 2) segments.push(coordinates)
  }
  return segments
}
