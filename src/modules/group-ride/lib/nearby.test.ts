import { describe, expect, test } from 'bun:test'
import type { GroupRideSummary } from 'vescape-core'

import { NEARBY_RADIUS_M, nearbyRides } from '@/modules/group-ride/lib/nearby'

// Krakow main square as the device's own location.
const OWN = { lat: 50.0619, lng: 19.9368 }

function ride(id: string, lat: number, lng: number): GroupRideSummary {
  return {
    id,
    name: `${id}'s ride`,
    createdAt: 0,
    riderCount: 1,
    location: { lat, lng },
    creator: { id: `c-${id}`, name: id },
  }
}

describe('nearbyRides', () => {
  test('keeps rides within the radius and drops the rest', () => {
    const close = ride('close', 50.0625, 19.945) // ~600m
    const far = ride('far', 50.3, 20.5) // well over 40km

    const result = nearbyRides([close, far], OWN)

    expect(result.rides.map((r) => r.ride.id)).toEqual(['close'])
    expect(result.badge).toBe(true)
  })

  test('sorts nearest first', () => {
    const near = ride('near', 50.0625, 19.938) // ~100m
    const mid = ride('mid', 50.08, 19.97) // ~2km

    const result = nearbyRides([mid, near], OWN)

    expect(result.rides.map((r) => r.ride.id)).toEqual(['near', 'mid'])
    expect(result.rides[0].distanceM).toBeLessThan(result.rides[1].distanceM)
  })

  test('no own location yields no rides and no badge', () => {
    const result = nearbyRides([ride('a', 50.0625, 19.945)], null)

    expect(result.rides).toEqual([])
    expect(result.badge).toBe(false)
  })

  test('empty active-ride list clears the badge', () => {
    expect(nearbyRides([], OWN)).toEqual({ rides: [], badge: false })
  })

  test('a ride exactly at the radius edge counts as nearby', () => {
    // Due north: 1 degree latitude ≈ 111.32 km, so radius/that ≈ the edge offset.
    const edgeOffsetDeg = NEARBY_RADIUS_M / 111_320
    const edge = ride('edge', OWN.lat + edgeOffsetDeg, OWN.lng)

    const result = nearbyRides([edge], OWN)

    expect(result.rides).toHaveLength(1)
  })
})
