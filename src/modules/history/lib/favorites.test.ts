import { expect, test } from 'bun:test'

import type { Favorite, TelemetryMinuteBucket } from 'vescape-core'

import {
  favoriteRangeForSession,
  favoriteToSession,
  findSessionFavorite,
  initialFavoriteTrimRangeForSession,
  sessionContainsFavorite,
} from '@/modules/history/lib/favorites'

const session = {
  startAtMs: 1_000_000,
  endAtMs: 1_600_000,
  movingStartAtMs: 1_100_000,
  movingEndAtMs: 1_500_000,
}

function favorite(overrides: Partial<Favorite>): Favorite {
  return {
    id: 'fav-1',
    boardId: 'board-uuid-1',
    boardName: 'Onewheel',
    name: null,
    startMs: 1_100_000,
    endMs: 1_500_000,
    createdAtMs: 0,
    updatedAtMs: 0,
    sampleCount: 0,
    gpsPointCount: 0,
    distanceM: null,
    movingDurationMs: 0,
    avgSpeedKmh: 0,
    maxSpeedKmh: 0,
    batteryUsedWh: 0,
    routePoints: [],
    ...overrides,
  }
}

test('canonical ride range uses the Moving Window, not the idle-padded span', () => {
  expect(favoriteRangeForSession(session)).toEqual({ startMs: 1_100_000, endMs: 1_500_000 })
})

test('legacy rides without a Moving Window fall back to their wall-clock span', () => {
  expect(
    favoriteRangeForSession({ ...session, movingStartAtMs: null, movingEndAtMs: null }),
  ).toEqual({ startMs: 1_000_000, endMs: 1_600_000 })
})

test('new trim handles start 15% inside each ride edge', () => {
  expect(initialFavoriteTrimRangeForSession(session)).toEqual({
    startMs: 1_160_000,
    endMs: 1_440_000,
  })
})

test('a ride counts as favorited only when a favorite covers its exact Moving Window', () => {
  expect(findSessionFavorite([favorite({})], session)?.id).toBe('fav-1')
  expect(findSessionFavorite([favorite({ endMs: 1_400_000 })], session)).toBeNull()
  expect(findSessionFavorite([favorite({ startMs: 1_050_000 })], session)).toBeNull()
})

function bucket(overrides: Partial<TelemetryMinuteBucket>): TelemetryMinuteBucket {
  return {
    id: 'bucket-1',
    startAtMs: 1_100_000,
    endAtMs: 1_160_000,
    bucketStartMs: 1_100_000,
    deviceId: 'ble-1',
    deviceName: 'VESC Board',
    sampleCount: 60,
    gpsPointCount: 10,
    preciseGpsPointCount: 8,
    maxAbsSpeedKmh: 40,
    maxGpsSpeedKmh: null,
    avgSpeedKmh: 20,
    avgSpeedSampleCount: 60,
    minBatteryVoltage: 48,
    maxMotorCurrent: 30,
    maxBatteryCurrent: 20,
    maxDuty: 0.5,
    distanceDeltaM: 500,
    gpsDistanceM: null,
    maxTempMosfet: 40,
    maxTempMotor: 35,
    batteryUsedWh: 8,
    batteryRegenWh: 1,
    firstLatitude: 52,
    firstLongitude: 21,
    firstMovingAtMs: 1_100_000,
    lastMovingAtMs: 1_160_000,
    boundaryBefore: 'none',
    ...overrides,
  }
}

test('a favorite-backed session reports the pinned range and the pinned summary', () => {
  const buckets = [
    bucket({ id: 'before', startAtMs: 900_000, endAtMs: 960_000 }),
    bucket({ id: 'inside', startAtMs: 1_100_000, endAtMs: 1_160_000 }),
    bucket({ id: 'tail', startAtMs: 1_160_001, endAtMs: 1_220_000, firstLatitude: 53 }),
  ]

  const detail = favoriteToSession(
    favorite({ sampleCount: 90, distanceM: 1_180, maxSpeedKmh: 32, avgSpeedKmh: 20 }),
    buckets,
  )

  expect(detail.id).toBe('favorite:fav-1')
  expect(detail.startAtMs).toBe(1_100_000)
  expect(detail.endAtMs).toBe(1_500_000)
  // A pinned range is its own Moving Window, so the chart shows exactly what was trimmed.
  expect(detail.movingStartAtMs).toBe(1_100_000)
  expect(detail.movingEndAtMs).toBe(1_500_000)
  // Stats come from the row, not from the buckets: the row was computed from raw samples.
  expect(detail.sampleCount).toBe(90)
  expect(detail.distanceM).toBe(1_180)
  expect(detail.maxSpeedKmh).toBe(32)
  // Only the buckets overlapping the range are read, and geography is derived from them.
  expect(detail.blockIds).toEqual(['inside', 'tail'])
  expect(detail.minLatitude).toBe(52)
  expect(detail.maxLatitude).toBe(53)
  expect(detail.deviceId).toBe('ble-1')
})

test('a favorite-backed session keeps board identity separate from its name', () => {
  expect(favoriteToSession(favorite({ name: 'Dolina single track' }), []).deviceName).toBe(
    'Onewheel',
  )
  expect(favoriteToSession(favorite({}), []).deviceName).toBe('Onewheel')
})

test('a favorite whose buckets are not loaded still yields a detail session', () => {
  const routePoints = [
    { latitude: 52, longitude: 21 },
    { latitude: 52.1, longitude: 21.1 },
  ]
  const detail = favoriteToSession(favorite({ sampleCount: 90, routePoints }), [])

  expect(detail.blockIds).toEqual([])
  expect(detail.routePoints).toEqual(routePoints)
  expect(detail.centerLatitude).toBe(52.05)
  expect(detail.sampleCount).toBe(90)
})

test('a ride contains a favorite when their ranges overlap at all', () => {
  expect(sessionContainsFavorite([favorite({ startMs: 900_000, endMs: 1_000_000 })], session)).toBe(
    true,
  )
  expect(
    sessionContainsFavorite([favorite({ startMs: 1_600_001, endMs: 1_700_000 })], session),
  ).toBe(false)
})
