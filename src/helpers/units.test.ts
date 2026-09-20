import { expect, test } from 'bun:test'
import {
  METERS_PER_MILE,
  speedFromKmh,
  speedFromMps,
  speedToKmh,
  speedInputToKmh,
  formatSpeedKmh,
  formatSpeedMps,
  formatDistanceMeters,
  formatRideDistanceMeters,
  formatLengthMeters,
} from './units'

test('board km/h and GPS m/s describe the same speed in either system', () => {
  for (const units of ['metric', 'imperial'] as const) {
    expect(speedFromMps(10, units)).toBeCloseTo(speedFromKmh(36, units))
    expect(formatSpeedMps(10, units)).toBe(formatSpeedKmh(36, units))
    expect(speedToKmh(speedFromKmh(40, units), units)).toBeCloseTo(40)
  }
  expect(formatSpeedKmh(40, 'imperial', 1)).toBe('24.9 mph')
  expect(formatSpeedKmh(40, 'metric')).toBe('40 km/h')
  expect(speedFromKmh(-16.09344, 'imperial')).toBeCloseTo(-10)
})

test('nearby-distance boundary and ride/fixed-length policies remain distinct', () => {
  expect(formatDistanceMeters(999, 'metric')).toBe('999 m')
  expect(formatDistanceMeters(1000, 'metric')).toBe('1.0 km')
  expect(formatDistanceMeters(METERS_PER_MILE * 0.1 - 0.001, 'imperial')).toBe('528 ft')
  expect(formatDistanceMeters(METERS_PER_MILE * 0.1, 'imperial')).toBe('0.1 mi')
  expect(formatRideDistanceMeters(METERS_PER_MILE, 'imperial')).toBe('1.0 mi')
  expect(formatRideDistanceMeters(0, 'imperial')).toBe('0.0 mi')
  expect(formatLengthMeters(METERS_PER_MILE, 'imperial')).toBe('5280 ft')
  expect(formatLengthMeters(1000, 'metric')).toBe('1000 m')
})

test('input conversion retains exact untouched values and physical bounds', () => {
  const canonical = 40.2336
  expect(speedInputToKmh(speedFromKmh(canonical, 'imperial'), canonical, 'imperial')).toBe(
    canonical,
  )
  expect(speedInputToKmh(25, 40, 'imperial')).toBeCloseTo(canonical)
  expect(speedInputToKmh(-1, 40, 'imperial', 5, 150)).toBe(5)
  expect(speedInputToKmh(200, 40, 'imperial', 5, 150)).toBe(150)
  expect(speedInputToKmh(speedFromKmh(150, 'imperial'), 40, 'imperial', 5, 150)).toBe(150)
})
