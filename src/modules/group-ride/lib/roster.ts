import type { GroupRideRider, PublicRider, PublicRiderPins } from 'vescape-core'

import { distanceMeters } from '@/helpers/mapGeometry'

export interface RosterRider extends GroupRideRider {
  isSelf: boolean
}

export const RIDER_STALE_AFTER_MS = 5_000

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
      row.hazard === other.hazard &&
      row.lastSeen === other.lastSeen &&
      row.isSelf === other.isSelf
    )
  })
}

export function riderRoster(
  riders: GroupRideRider[],
  ownRiderId: string | null,
  nowMs = Date.now(),
): RosterRider[] {
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

export const NEARBY_RIDER_LIMIT = 20

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_NEARBY_BAND_M`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_NEARBY_BAND_M`
 */
export const NEARBY_RIDER_BAND_M = 250

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `nearbyOrder`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `nearbyOrder`
 */
export function publicRiderRoster(
  riders: PublicRider[],
  ownLocation: { lat: number; lng: number } | null,
  pins: PublicRiderPins[] = [],
  limit = NEARBY_RIDER_LIMIT,
): RosterRider[] {
  const pinsOf = new Map(pins.map((entry) => [entry.accountId, entry]))
  const ranked = riders.map((rider, index) => ({
    rider,
    index,
    distanceM:
      ownLocation && rider.presence
        ? distanceMeters(
            { latitude: ownLocation.lat, longitude: ownLocation.lng },
            { latitude: rider.presence.lat, longitude: rider.presence.lng },
          )
        : rider.presence
          ? null
          : Infinity,
  }))
  const nearest = ranked
    .slice()
    .sort((a, b) => rankDistance(a) - rankDistance(b) || a.index - b.index)
    .slice(0, limit)
  const rows: RosterRider[] = nearest
    .sort((a, b) => {
      const band = rankBand(a) - rankBand(b)
      if (band) return band
      if (!ownLocation) return a.index - b.index
      return a.rider.accountId < b.rider.accountId
        ? -1
        : a.rider.accountId > b.rider.accountId
          ? 1
          : 0
    })
    .map(({ rider }) => ({
      id: rider.accountId,
      name: rider.nick,
      presence: rider.presence,
      trail: rider.trail,
      stale: rider.stale || rider.away,
      away: rider.away,
      lastSeen: rider.lastSeen,
      signal: pinsOf.get(rider.accountId)?.signal ?? null,
      hazard: pinsOf.get(rider.accountId)?.hazard ?? null,
      isSelf: false,
    }))
  const shown = new Set(rows.map((row) => row.id))
  const unplaced = pins
    .filter((entry) => !shown.has(entry.accountId))
    .map((entry) => ({
      id: entry.accountId,
      name: entry.nick,
      presence: null,
      trail: null,
      stale: false,
      away: false,
      lastSeen: 0,
      signal: entry.signal,
      hazard: entry.hazard,
      isSelf: false,
    }))
  return [...rows, ...unplaced]
}

function rankDistance({ distanceM }: { distanceM: number | null }): number {
  return distanceM ?? 0
}

function rankBand({ distanceM }: { distanceM: number | null }): number {
  return distanceM == null ? 0 : Math.floor(distanceM / NEARBY_RIDER_BAND_M)
}
