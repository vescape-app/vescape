import { expect, test } from 'bun:test'
import type { GpsDisplayMotion } from 'vescape-core'
import { GpsDisplayTrail } from './gpsDisplayTrail'

const motion: GpsDisplayMotion = {
  fromLongitude: 0,
  fromLatitude: 0,
  toLongitude: 0.001,
  toLatitude: 0,
  startsAtMs: 1_000,
  endsAtMs: 2_000,
  longitudePerMs: 0.000001,
  velocityExpiresAtMs: 3_000,
}

test('records correction and prediction between GPS fixes without rewriting past samples', () => {
  const trail = new GpsDisplayTrail()
  for (let now = 1_000; now <= 2_000; now += 50) trail.sample(motion, now)
  const before = trail.shape()!.geometry.coordinates[0]
  expect(before).toHaveLength(21)
  expect(before[10][0]).toBeCloseTo(0.001, 8)
  expect(before[20][0]).toBeCloseTo(0.002, 8)
  const braking = {
    ...motion,
    fromLongitude: 0.002,
    toLongitude: 0.002,
    startsAtMs: 2_000,
    endsAtMs: 2_000,
    longitudePerMs: 0,
  }
  trail.sample(braking, 2_050)
  trail.sample(braking, 2_500)
  expect(trail.shape()!.geometry.coordinates[0]).toEqual(before)
})

test('pauses and GPS position resets leave separate segments rather than invented travel', () => {
  const trail = new GpsDisplayTrail()
  trail.sample(motion, 1_000)
  trail.sample(motion, 1_100)
  trail.pause()
  trail.sample(motion, 1_200)
  trail.sample(motion, 1_300)
  const reset = { ...motion, resetPosition: true }
  trail.sample(reset, 1_400)
  trail.sample(reset, 1_500)
  expect(trail.shape()!.geometry.coordinates.map((line) => line.length)).toEqual([2, 2, 2])
  trail.sample(motion, 4_000)
  trail.sample(motion, 4_050)
  // Expired prediction is stationary; no duplicated points or line bridging the gap.
  expect(trail.shape()!.geometry.coordinates).toHaveLength(3)
})

test('bounds dense history to five minutes and does not backfill gaps', () => {
  const trail = new GpsDisplayTrail()
  const continuous = { ...motion, endsAtMs: 1_000, velocityExpiresAtMs: 1_000_000 }
  for (let now = 1_000; now <= 302_000; now += 50) trail.sample(continuous, now)
  const points = trail.shape()!.geometry.coordinates.flat()
  expect(points).toHaveLength(6_000)
  expect(points.at(-1)![0]).toBeCloseTo(0.302, 8)
  trail.sample(continuous, 700_000)
  expect(trail.shape()).toBeNull()
})
