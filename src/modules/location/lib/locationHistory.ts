import type { LocationEvent } from 'vescape-core'

import { insertByTime, pruneByTime } from '@/helpers/timeSeries'

export interface LocationHistory {
  locations: LocationEvent[]
  latestApproximateLocation: LocationEvent | null
}

export function createLocationHistory(): LocationHistory {
  return { locations: [], latestApproximateLocation: null }
}

/** Precise fixes form the trail; the newest fix of either precision places the puck. */
export function appendLocation(
  history: LocationHistory,
  location: LocationEvent,
  windowMs: number,
): void {
  if (
    history.latestApproximateLocation == null ||
    location.timestamp > history.latestApproximateLocation.timestamp
  ) {
    history.latestApproximateLocation = location
  }
  if (!location.precise) return

  insertByTime(history.locations, location, (sample) => sample.timestamp)
  const latest = history.locations.at(-1)
  if (latest) {
    pruneByTime(history.locations, latest.timestamp, windowMs, (sample) => sample.timestamp)
  }
}
