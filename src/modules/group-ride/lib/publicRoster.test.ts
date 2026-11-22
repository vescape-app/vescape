import { describe, expect, test } from 'bun:test'
import type { PublicRider } from 'vescape-core'

import { NEARBY_RIDER_LIMIT, publicRiderRoster } from '@/modules/group-ride/lib/roster'

const OWN = { lat: 50.0619, lng: 19.9368 }
const NORTH_M = 1 / 111_320

function rider(accountId: string, metersNorth: number | null, away = false): PublicRider {
  return {
    accountId,
    nick: accountId,
    presence: metersNorth == null ? null : { lat: OWN.lat + metersNorth * NORTH_M, lng: OWN.lng },
    stale: false,
    away,
    lastSeen: 0,
  } as PublicRider
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

describe('publicRiderRoster', () => {
  test('orders nearest first, riders without a position last', () => {
    const rows = publicRiderRoster(
      [rider('none', null), rider('far', 5_000), rider('near', 300), rider('mid', 1_200)],
      OWN,
    )
    expect(ids(rows)).toEqual(['near', 'mid', 'far', 'none'])
  })

  test('keeps a fixed order inside one distance band, so GPS jitter does not swap rows', () => {
    const before = publicRiderRoster([rider('b', 510), rider('a', 560)], OWN)
    const after = publicRiderRoster([rider('b', 580), rider('a', 530)], OWN)
    expect(ids(before)).toEqual(['a', 'b'])
    expect(ids(after)).toEqual(['a', 'b'])
  })

  test('keeps only the nearest riders up to the limit', () => {
    const riders = Array.from({ length: NEARBY_RIDER_LIMIT + 5 }, (_, i) =>
      rider(`r${String(i).padStart(2, '0')}`, (NEARBY_RIDER_LIMIT + 5 - i) * 1_000),
    )
    const rows = publicRiderRoster(riders, OWN)
    expect(rows).toHaveLength(NEARBY_RIDER_LIMIT)
    expect(rows[0].id).toBe(`r${NEARBY_RIDER_LIMIT + 4}`)
    expect(ids(rows)).not.toContain('r00')
  })

  test('without an own location keeps the relay order and the limit', () => {
    const rows = publicRiderRoster([rider('x', 9_000), rider('y', 10), rider('z', 50)], null, [], 2)
    expect(ids(rows)).toEqual(['x', 'y'])
  })

  test('an away rider stays at their last position, muted', () => {
    const [row] = publicRiderRoster([rider('gone', 100, true)], OWN)
    expect(row).toMatchObject({ id: 'gone', away: true, stale: true, isSelf: false })
    expect(row.presence).not.toBeNull()
  })

  test("riders wear their pins, and a far-away friend's pins follow as an unplaced row", () => {
    const signal = { kind: 'serious', lat: 1, lng: 2, startedAt: 5, expiresAt: 9 }
    const hazard = { kind: 'police', lat: 1, lng: 2, startedAt: 5, expiresAt: 9 }
    const rows = publicRiderRoster([rider('near', 100)], OWN, [
      { accountId: 'near', nick: 'near', signal: null, hazard },
      { accountId: 'friend', nick: 'Ola', signal, hazard: null },
    ])
    expect(ids(rows)).toEqual(['near', 'friend'])
    expect(rows[0]).toMatchObject({ hazard, signal: null })
    expect(rows[1]).toMatchObject({ name: 'Ola', presence: null, signal })
  })
})
