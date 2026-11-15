import { describe, expect, test } from 'bun:test'
import type { RodeWithCrewRide, RodeWithRider } from 'vescape-core'

import { RODE_WITH_MAX_RANGE_MS, rodeWith, rodeWithWindows } from './rodeWith'

const rider = (accountId: string, nick: string, startedAt: string, points = 2): RodeWithRider => ({
  accountId,
  nick,
  nationality: null,
  startedAt,
  endedAt: startedAt,
  track: Array.from({ length: points }, (_, i) => ({ at: i, lat: i, lng: i + 10 })),
})

const crewRide = (startedAt: string, riders: RodeWithRider[]): RodeWithCrewRide => ({
  startedAt,
  endedAt: startedAt,
  riders,
})

describe('rodeWithWindows', () => {
  test('splits a ride longer than the server range', () => {
    expect(rodeWithWindows(0, RODE_WITH_MAX_RANGE_MS + 5)).toEqual([
      [0, RODE_WITH_MAX_RANGE_MS],
      [RODE_WITH_MAX_RANGE_MS, RODE_WITH_MAX_RANGE_MS + 5],
    ])
  })

  test('an empty ride asks nothing', () => {
    expect(rodeWithWindows(5, 5)).toEqual([])
  })
})

describe('rodeWith', () => {
  test('a ride overlapping two Crew Rides shows riders from both', () => {
    const result = rodeWith([
      crewRide('a', [rider('1', 'zed', 'a'), rider('2', 'amy', 'a')]),
      crewRide('b', [rider('1', 'zed', 'b'), rider('3', 'bob', 'b')]),
    ])
    expect(result.riders.map((r) => r.nick)).toEqual(['amy', 'bob', 'zed'])
    expect(result.tracks.map((t) => t.key)).toEqual(['1-a', '2-a', '1-b', '3-b'])
    expect(result.tracks[0].coordinates).toEqual([
      [10, 0],
      [11, 1],
    ])
  })

  test('a rider without a drawable track is still named', () => {
    const result = rodeWith([crewRide('a', [rider('1', 'zed', 'a', 1)])])
    expect(result.riders).toEqual([{ accountId: '1', nick: 'zed' }])
    expect(result.tracks).toEqual([])
  })
})
