import { describe, expect, test } from 'bun:test'
import type { HistoryGpsSample } from 'vescape-core'

import { getFavoriteRouteSegments } from '@/modules/history/lib/favoriteRoute'

function gps(capturedAtMs: number, longitude: number): HistoryGpsSample {
  return {
    id: capturedAtMs,
    capturedAtMs,
    deviceId: 'board',
    deviceName: 'Board',
    longitude,
    latitude: longitude,
    speedMps: null,
    bearingDeg: null,
    accuracyM: null,
    altitudeM: null,
    timestamp: capturedAtMs,
    precise: true,
    distanceFromPreviousM: null,
  }
}

const route = [gps(0, 0), gps(1_000, 10), gps(2_000, 20), gps(3_000, 30)]

describe('favorite route segments', () => {
  test('interpolates favorite edges between persisted GPS samples', () => {
    expect(getFavoriteRouteSegments(route, [{ startMs: 500, endMs: 1_500 }])).toEqual([
      [
        [5, 5],
        [10, 10],
        [15, 15],
      ],
    ])
  })

  test('merges overlapping favorites into one glow segment', () => {
    expect(
      getFavoriteRouteSegments(route, [
        { startMs: 250, endMs: 1_250 },
        { startMs: 1_000, endMs: 2_500 },
      ]),
    ).toEqual([
      [
        [2.5, 2.5],
        [10, 10],
        [20, 20],
        [25, 25],
      ],
    ])
  })

  test('keeps separate favorites as separate route segments', () => {
    expect(
      getFavoriteRouteSegments(route, [
        { startMs: 0, endMs: 500 },
        { startMs: 2_500, endMs: 3_000 },
      ]),
    ).toEqual([
      [
        [0, 0],
        [5, 5],
      ],
      [
        [25, 25],
        [30, 30],
      ],
    ])
  })
})
