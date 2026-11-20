import type { RodeWithCrewRide } from 'vescape-core'

/** The server answers at most this much of a ride per call. */
export const RODE_WITH_MAX_RANGE_MS = 24 * 60 * 60 * 1000

/** One other rider's stretch of one Crew Ride, ready for the ride map. */
export interface RodeWithTrack {
  /** Unique per rider per Crew Ride: one rider can share several Crew Rides with one ride. */
  key: string
  accountId: string
  coordinates: [number, number][]
}

export interface RodeWith {
  /** Everyone the rider rode with, once each, by nick. */
  riders: { accountId: string; nick: string }[]
  tracks: RodeWithTrack[]
}

export const NO_RODE_WITH: RodeWith = { riders: [], tracks: [] }

/** `[from, to]` windows covering the ride, each within the server's range limit. */
export function rodeWithWindows(startMs: number, endMs: number): [number, number][] {
  const windows: [number, number][] = []
  for (let from = startMs; from < endMs; from += RODE_WITH_MAX_RANGE_MS) {
    windows.push([from, Math.min(endMs, from + RODE_WITH_MAX_RANGE_MS)])
  }
  return windows
}

/** Every rider from every Crew Ride the ride overlapped, each track on its own together part. */
export function rodeWith(crewRides: RodeWithCrewRide[]): RodeWith {
  const riders = new Map<string, string>()
  const tracks: RodeWithTrack[] = []
  for (const crewRide of crewRides) {
    for (const rider of crewRide.riders) {
      riders.set(rider.accountId, rider.nick)
      if (rider.track.length < 2) continue
      tracks.push({
        key: `${rider.accountId}-${rider.startedAt}`,
        accountId: rider.accountId,
        coordinates: rider.track.map((point) => [point.lng, point.lat]),
      })
    }
  }
  return {
    riders: [...riders]
      .map(([accountId, nick]) => ({ accountId, nick }))
      .sort((a, b) => a.nick.localeCompare(b.nick)),
    tracks,
  }
}
