import { describe, expect, test } from 'bun:test'
import type { GroupRideRider } from 'vescape-core'

import { RIDER_STALE_AFTER_MS, riderRoster, rosterRowsEqual } from '@/modules/group-ride/lib/roster'

const OWN = { lat: 50.0619, lng: 19.9368 }

function rider(id: string, lat: number | null, stale = false): GroupRideRider {
  return {
    id,
    name: id,
    color: null,
    stale,
    away: false,
    lastSeen: 0,
    presence: lat == null ? null : { lat, lng: OWN.lng },
  }
}

describe('riderRoster', () => {
  test('pins the current Rider to the front, flagged as self', () => {
    const rows = riderRoster([rider('bob', OWN.lat), rider('me', OWN.lat)], 'me', OWN, 0)
    expect(rows.map((r) => r.id)).toEqual(['me', 'bob'])
    expect(rows[0].isSelf).toBe(true)
    expect(rows[1].isSelf).toBe(false)
  })

  test('sorts self first, then fresh riders with locations before stale or locationless', () => {
    const result = riderRoster(
      [
        rider('stale', OWN.lat, true),
        rider('far', OWN.lat + 0.02),
        rider('near', OWN.lat + 0.001),
        rider('none', null),
        rider('me', OWN.lat + 0.05),
      ],
      'me',
      OWN,
      0,
    )

    expect(result.map((r) => r.id)).toEqual(['me', 'near', 'far', 'none', 'stale'])
    expect(result[1].distanceM).toBeLessThan(result[2].distanceM!)
  })

  test('keeps null distance when own location is unavailable', () => {
    expect(riderRoster([rider('bob', OWN.lat)], null, null, 0)[0].distanceM).toBeNull()
  })

  test('greys riders from the client clock before the server marks stale', () => {
    const now = 10_000
    const rows = riderRoster(
      [{ ...rider('bob', OWN.lat), lastSeen: now - RIDER_STALE_AFTER_MS }],
      null,
      OWN,
      now,
    )

    expect(rows[0].stale).toBe(true)
  })

  test('keeps riders however long silent, greyed at their last presence', () => {
    const now = 3_600_000
    const away = { ...rider('away', OWN.lat), away: true, lastSeen: now }
    const silent = { ...rider('silent', OWN.lat), lastSeen: 0 }

    const rows = riderRoster([away, silent], null, OWN, now)

    expect(rows.map((r) => [r.id, r.stale])).toEqual([
      ['away', true],
      ['silent', true],
    ])
    expect(rows[0].presence).toBe(away.presence)
  })
})

describe('rosterRowsEqual', () => {
  test('recomputed rows from identical inputs compare equal (freshness-tick no-op)', () => {
    const riders = [rider('bob', OWN.lat), rider('me', OWN.lat)]
    const a = riderRoster(riders, 'me', OWN, 0)
    const b = riderRoster(riders, 'me', OWN, 100)
    expect(a).not.toBe(b)
    expect(rosterRowsEqual(a, b)).toBe(true)
  })

  test('detects a rider crossing the stale threshold', () => {
    const riders = [rider('bob', OWN.lat)]
    const before = riderRoster(riders, null, OWN, 0)
    const after = riderRoster(riders, null, OWN, RIDER_STALE_AFTER_MS)
    expect(rosterRowsEqual(before, after)).toBe(false)
  })

  test('detects a distance change from own-location movement', () => {
    const riders = [rider('bob', OWN.lat + 0.01)]
    const near = riderRoster(riders, null, OWN, 0)
    const far = riderRoster(riders, null, { ...OWN, lat: OWN.lat - 0.01 }, 0)
    expect(rosterRowsEqual(near, far)).toBe(false)
  })
})
