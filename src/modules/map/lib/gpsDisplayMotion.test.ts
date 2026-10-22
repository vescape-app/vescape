import { expect, test } from 'bun:test'
import { gpsDisplayPosition } from './gpsDisplayMotion'

test('samples the native segment after delivery lag and holds its endpoints', () => {
  const segment = {
    fromLatitude: 0,
    fromLongitude: 0,
    toLatitude: 10,
    toLongitude: 20,
    startsAtMs: 10_000,
    endsAtMs: 11_000,
  }
  expect(gpsDisplayPosition(segment, 9_000)).toEqual([0, 0])
  expect(gpsDisplayPosition(segment, 10_250)).toEqual([5, 2.5])
  expect(gpsDisplayPosition(segment, 99_000)).toEqual([20, 10])
})

test('crosses the antimeridian by the short arc with valid longitude on every frame', () => {
  const segment = {
    fromLatitude: 0,
    fromLongitude: 179,
    toLatitude: 0,
    toLongitude: -179,
    startsAtMs: 0,
    endsAtMs: 1000,
  }
  expect(gpsDisplayPosition(segment, 500)).toEqual([-180, 0])
  expect(gpsDisplayPosition(segment, 750)).toEqual([-179.5, 0])
})

test('prediction continues independently after correction and freezes at telemetry expiry', () => {
  const motion = {
    fromLatitude: 0,
    fromLongitude: 0,
    toLatitude: 1,
    toLongitude: 0,
    startsAtMs: 1000,
    endsAtMs: 1500,
    latitudePerMs: 0.001,
    longitudePerMs: 0,
    velocityExpiresAtMs: 2000,
  }
  expect(gpsDisplayPosition(motion, 1250)[1]).toBeCloseTo(0.75)
  expect(gpsDisplayPosition(motion, 1750)[1]).toBeCloseTo(1.75)
  expect(gpsDisplayPosition(motion, 9000)[1]).toBeCloseTo(2)
})
