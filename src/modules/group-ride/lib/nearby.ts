import type { GroupRideSummary } from 'vescape-core'

import { distanceMeters } from '@/helpers/mapGeometry'

/** Discovery radius for nearby Group Rides. Rides farther than this are filtered out. */
export const NEARBY_RADIUS_M = 40_000

export interface NearbyRide {
  ride: GroupRideSummary
  /** Great-circle distance from the device's own location, in meters. */
  distanceM: number
}

export interface NearbyResult {
  /** Rides within the radius, nearest first. */
  rides: NearbyRide[]
  /** Social-button badge state: true when at least one nearby ride exists. */
  badge: boolean
}

/**
 * Pure nearby filter for Group Rides. Takes the active-ride list plus the device's own
 * location and returns the rides within {@link NEARBY_RADIUS_M}, nearest first, with the
 * Social-button badge state. Distance is computed locally — observing sends no location.
 * With no own location yet, nothing can be ranked, so the result is empty with no badge.
 */
export function nearbyRides(
  rides: GroupRideSummary[],
  ownLocation: { lat: number; lng: number } | null,
  radiusM: number = NEARBY_RADIUS_M,
): NearbyResult {
  if (!ownLocation) return { rides: [], badge: false }

  const from = { latitude: ownLocation.lat, longitude: ownLocation.lng }
  const nearby = rides
    .map((ride) => ({
      ride,
      distanceM: distanceMeters(from, {
        latitude: ride.location.lat,
        longitude: ride.location.lng,
      }),
    }))
    .filter((entry) => entry.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)

  return { rides: nearby, badge: nearby.length > 0 }
}
