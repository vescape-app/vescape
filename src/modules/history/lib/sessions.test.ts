import { expect, test } from 'bun:test'

import {
  groupHistorySessions,
  rideDurationMs,
  rideMovingWindow,
} from '@/modules/history/lib/sessions'
import { makeBlock as block } from '@/test-utils/factories'

test('moving window spans the outermost moving samples across blocks', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'a',
      startAtMs: 0,
      endAtMs: 60_000,
      firstMovingAtMs: 20_000,
      lastMovingAtMs: 55_000,
    }),
    block({
      id: 'b',
      startAtMs: 60_000,
      endAtMs: 120_000,
      firstMovingAtMs: 61_000,
      lastMovingAtMs: 90_000,
    }),
  ])

  expect(rideMovingWindow(sessions[0])).toEqual({ startMs: 20_000, endMs: 90_000 })
  // Time is the riding span (ends trimmed), not the 0–120s wall-clock span.
  expect(rideDurationMs(sessions[0])).toBe(70_000)
})

test('rideDurationMs falls back to wall-clock when no moving window exists', () => {
  const session = {
    movingStartAtMs: null,
    movingEndAtMs: null,
    startAtMs: 1_000,
    endAtMs: 61_000,
  }
  expect(rideMovingWindow(session)).toBeNull()
  expect(rideDurationMs(session)).toBe(60_000)
})

test('combines same-device adjacent blocks under the split gap', () => {
  const sessions = groupHistorySessions([
    block({ id: 'new', startAtMs: 300_000, endAtMs: 360_000 }),
    block({ id: 'old', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(1)
  expect(sessions[0].blockIds).toEqual(['old', 'new'])
})

test('splits same-device blocks over the default 30 min split gap', () => {
  const sessions = groupHistorySessions([
    block({ id: 'new', startAtMs: 2_000_000, endAtMs: 2_060_000 }),
    block({ id: 'old', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(2)
})

test('a stop under the default split gap stays one ride (the coffee-break case)', () => {
  const sessions = groupHistorySessions([
    block({ id: 'after', startAtMs: 900_000, endAtMs: 960_000 }),
    block({ id: 'before', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(1)
})

test('rider-set gap overrides the default', () => {
  const blocks = [
    block({ id: 'after', startAtMs: 900_000, endAtMs: 960_000 }),
    block({ id: 'before', startAtMs: 120_000, endAtMs: 180_000 }),
  ]
  expect(groupHistorySessions(blocks, { gapMs: 5 * 60_000 })).toHaveLength(2)
})

test('splits different devices even when adjacent', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      deviceId: 'dev-b',
      deviceName: 'Board B',
      startAtMs: 240_000,
      endAtMs: 300_000,
    }),
    block({ id: 'old', deviceId: 'dev-a', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(2)
})

test('splits on disconnected, app_stop and error boundaries', () => {
  const sessions = groupHistorySessions([
    block({ id: 'err', startAtMs: 600_000, endAtMs: 660_000, boundaryBefore: 'error' }),
    block({ id: 'stop', startAtMs: 420_000, endAtMs: 480_000, boundaryBefore: 'app_stop' }),
    block({ id: 'disc', startAtMs: 240_000, endAtMs: 300_000, boundaryBefore: 'disconnected' }),
    block({ id: 'base', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(4)
})

test('keeps connected boundary in same grouped ride when gap small', () => {
  const sessions = groupHistorySessions([
    block({ id: 'new', startAtMs: 240_000, endAtMs: 300_000, boundaryBefore: 'connected' }),
    block({ id: 'old', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(1)
})

test('keeps connection_lost boundary in same grouped ride when gap small', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      startAtMs: 240_000,
      endAtMs: 300_000,
      boundaryBefore: 'connection_lost',
    }),
    block({ id: 'old', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions).toHaveLength(1)
})

test('distance prefers distanceDelta sum', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      startAtMs: 240_000,
      endAtMs: 300_000,
      distanceDeltaM: 200,
      gpsDistanceM: 1,
    }),
    block({
      id: 'old',
      startAtMs: 120_000,
      endAtMs: 180_000,
      distanceDeltaM: 100,
      gpsDistanceM: 1,
    }),
  ])
  expect(sessions[0].distanceM).toBe(300)
})

test('distance falls back to gpsDistance when odometer distance missing', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      startAtMs: 240_000,
      endAtMs: 300_000,
      distanceDeltaM: null,
      gpsDistanceM: 60,
    }),
    block({
      id: 'old',
      startAtMs: 120_000,
      endAtMs: 180_000,
      distanceDeltaM: null,
      gpsDistanceM: 40,
    }),
  ])
  expect(sessions[0].distanceM).toBe(100)
})

test('max speed uses sanitized board bucket max instead of gps speed', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      startAtMs: 240_000,
      endAtMs: 300_000,
      maxAbsSpeedKmh: 20,
      maxGpsSpeedKmh: 34,
    }),
    block({
      id: 'old',
      startAtMs: 120_000,
      endAtMs: 180_000,
      maxAbsSpeedKmh: 25,
      maxGpsSpeedKmh: 18,
    }),
  ])
  expect(sessions[0].maxSpeedKmh).toBe(25)
})

test('avg speed excludes samples below moving speed threshold when available', () => {
  const sessions = groupHistorySessions([
    block({
      id: 'new',
      startAtMs: 240_000,
      endAtMs: 300_000,
      avgSpeedKmh: 20,
      avgSpeedSampleCount: 2,
      sampleCount: 10,
    }),
    block({
      id: 'old',
      startAtMs: 120_000,
      endAtMs: 180_000,
      avgSpeedKmh: 10,
      avgSpeedSampleCount: 3,
      sampleCount: 10,
    }),
  ])

  expect(sessions[0].avgSpeedKmh).toBe(14)
})

test('drops a session with no moving samples (board on but never ridden)', () => {
  const sessions = groupHistorySessions([
    block({
      avgSpeedKmh: 0,
      avgSpeedSampleCount: 0,
      sampleCount: 10,
    }),
  ])

  expect(sessions).toHaveLength(0)
})

test('keeps legacy sessions whose moving count was never computed', () => {
  // Legacy buckets bridge avgSpeedSampleCount = sampleCount (> 0), so they must stay visible.
  const sessions = groupHistorySessions([
    block({
      avgSpeedKmh: 12,
      avgSpeedSampleCount: 10,
      sampleCount: 10,
      firstMovingAtMs: null,
      lastMovingAtMs: null,
    }),
  ])

  expect(sessions).toHaveLength(1)
  expect(sessions[0].movingStartAtMs).toBeNull()
})

test('returns newest-first sessions', () => {
  const sessions = groupHistorySessions([
    block({ id: 'new', startAtMs: 2_000_000, endAtMs: 2_060_000 }),
    block({ id: 'old', startAtMs: 120_000, endAtMs: 180_000 }),
  ])
  expect(sessions[0].startAtMs).toBe(2_000_000)
  expect(sessions[1].startAtMs).toBe(120_000)
})
