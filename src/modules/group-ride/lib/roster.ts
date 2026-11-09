import type { GroupRideRider } from 'vescape-core'

export interface RosterRider extends GroupRideRider {
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
      row.presence === other.presence &&
      row.trail === other.trail &&
      row.stale === other.stale &&
      row.away === other.away &&
      row.signal === other.signal &&
      row.lastSeen === other.lastSeen &&
      row.isSelf === other.isSelf
    )
  })
}

/**
 * The roster in a stable order: the device's own Rider first, then by name, then by id. Nothing
 * that changes while riding (distance, stale, away) moves a row.
 */
export function riderRoster(
  riders: GroupRideRider[],
  ownRiderId: string | null,
  nowMs = Date.now(),
): RosterRider[] {
  // Nobody is dropped client-side: the relay's roster decides who is in the ride. A Rider unheard
  // for RIDER_STALE_AFTER_MS, or away, greys out at their last presence.
  return riders
    .map((rider) => ({
      ...rider,
      stale: rider.stale || rider.away || nowMs - rider.lastSeen >= RIDER_STALE_AFTER_MS,
      isSelf: rider.id === ownRiderId,
    }))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
      return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })
}
