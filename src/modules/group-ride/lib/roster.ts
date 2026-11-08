import type { GroupRideRider } from 'vescape-core'

import { distanceMeters } from '@/helpers/mapGeometry'

export interface RosterRider extends GroupRideRider {
  distanceM: number | null
  /** True for the device's own Rider — pinned first and labelled "You". */
  isSelf: boolean
}

export const RIDER_STALE_AFTER_MS = 5_000

/**
 * True when both roster views are equivalent, so store updates can keep the
 * previous array reference and downstream selectors/memos stay quiet.
 * Rows are shallow-compared: `presence`/`trail` come from the same source
 * rider objects, so reference equality covers them.
 */
export function rosterRowsEqual(a: RosterRider[], b: RosterRider[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((row, index) => {
    const other = b[index]
    return (
      row.id === other.id &&
      row.name === other.name &&
      row.color === other.color &&
      row.presence === other.presence &&
      row.trail === other.trail &&
      row.stale === other.stale &&
      row.away === other.away &&
      row.lastSeen === other.lastSeen &&
      row.distanceM === other.distanceM &&
      row.isSelf === other.isSelf
    )
  })
}

export function riderRoster(
  riders: GroupRideRider[],
  ownRiderId: string | null,
  ownLocation: { lat: number; lng: number } | null,
  nowMs = Date.now(),
): RosterRider[] {
  const from = ownLocation ? { latitude: ownLocation.lat, longitude: ownLocation.lng } : null

  // Nobody is dropped client-side: the relay's roster decides who is in the ride. A Rider unheard
  // for RIDER_STALE_AFTER_MS, or away, greys out at their last presence.
  return riders
    .map((rider) => ({
      ...rider,
      stale: rider.stale || rider.away || nowMs - rider.lastSeen >= RIDER_STALE_AFTER_MS,
      isSelf: rider.id === ownRiderId,
      distanceM:
        from && rider.presence
          ? distanceMeters(from, {
              latitude: rider.presence.lat,
              longitude: rider.presence.lng,
            })
          : null,
    }))
    .sort((a, b) => {
      // The device's own Rider is always pinned to the front of the roster.
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
      if (a.stale !== b.stale) return a.stale ? 1 : -1
      if (a.distanceM == null && b.distanceM == null) return a.name.localeCompare(b.name)
      if (a.distanceM == null) return 1
      if (b.distanceM == null) return -1
      return a.distanceM - b.distanceM
    })
}
