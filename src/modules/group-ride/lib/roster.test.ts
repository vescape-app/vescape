import { describe, expect, test } from 'bun:test'
import type { GroupRideRider } from 'vescape-core'

import { RIDER_STALE_AFTER_MS, riderRoster, rosterRowsEqual } from '@/modules/group-ride/lib/roster'

const OWN = { lat: 50.0619, lng: 19.9368 }

function rider(id: string, lat: number | null, stale = false, name = id): GroupRideRider {
  return {
    id,
    name,
    stale,
    away: false,
    lastSeen: 0,
    presence: lat == null ? null : { lat, lng: OWN.lng },
  }
}

describe('riderRoster', () => {
  test('pins the current Rider to the front, flagged as self', () => {
    const rows = riderRoster([rider('bob', OWN.lat), rider('me', OWN.lat)], 'me', 0)
    expect(rows.map((r) => r.id)).toEqual(['me', 'bob'])
    expect(rows[0].isSelf).toBe(true)
    expect(rows[1].isSelf).toBe(false)
  })

  test('sorts self first, then by name, then by id; distance, stale and away never move a row', () => {
    const riders = [
      rider('zed', OWN.lat + 0.001, false, 'Zed'),
      { ...rider('ana-2', OWN.lat + 0.02, false, 'Ana'), away: true },
      rider('ana-1', null, true, 'Ana'),
      rider('bea', OWN.lat + 0.05, false, 'Bea'),
      rider('me', OWN.lat, false, 'Zz me'),
    ]

    const ids = riderRoster(riders, 'me', 0).map((r) => r.id)
    expect(ids).toEqual(['me', 'ana-1', 'ana-2', 'bea', 'zed'])

    // Everyone swapping places, going stale or coming back keeps the same order.
    const shuffled = [riders[3], { ...riders[2], stale: false }, riders[0], riders[4], riders[1]]
    expect(riderRoster(shuffled, 'me', RIDER_STALE_AFTER_MS * 10).map((r) => r.id)).toEqual(ids)
  })

  test('greys riders from the client clock before the server marks stale', () => {
    const now = 10_000
    const rows = riderRoster(
      [{ ...rider('bob', OWN.lat), lastSeen: now - RIDER_STALE_AFTER_MS }],
      null,
      now,
    )

    expect(rows[0].stale).toBe(true)
  })

  test('keeps riders however long silent, greyed at their last presence', () => {
    const now = 3_600_000
    const away = { ...rider('away', OWN.lat), away: true, lastSeen: now }
    const silent = { ...rider('silent', OWN.lat), lastSeen: 0 }

    const rows = riderRoster([away, silent], null, now)

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
    const a = riderRoster(riders, 'me', 0)
    const b = riderRoster(riders, 'me', 100)
    expect(a).not.toBe(b)
    expect(rosterRowsEqual(a, b)).toBe(true)
  })

  test('detects a rider crossing the stale threshold', () => {
    const riders = [rider('bob', OWN.lat)]
    const before = riderRoster(riders, null, 0)
    const after = riderRoster(riders, null, RIDER_STALE_AFTER_MS)
    expect(rosterRowsEqual(before, after)).toBe(false)
  })
})
