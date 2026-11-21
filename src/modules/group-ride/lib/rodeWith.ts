import type { RodeWithCrewRide } from 'vescape-core'

export const RODE_WITH_MAX_RANGE_MS = 24 * 60 * 60 * 1000

export interface RodeWithTrack {
  key: string
  accountId: string
  coordinates: [number, number][]
}

export interface RodeWith {
  riders: { accountId: string; nick: string }[]
  tracks: RodeWithTrack[]
}

export const NO_RODE_WITH: RodeWith = { riders: [], tracks: [] }

export function rodeWithWindows(startMs: number, endMs: number): [number, number][] {
  const windows: [number, number][] = []
  for (let from = startMs; from < endMs; from += RODE_WITH_MAX_RANGE_MS) {
    windows.push([from, Math.min(endMs, from + RODE_WITH_MAX_RANGE_MS)])
  }
  return windows
}

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
