import { expect, test } from 'bun:test'
import {
  METERS_PER_MILE,
  speedFromKmh,
  speedFromMps,
  speedToKmh,
  speedInputToKmh,
  formatSpeedValue,
  formatSpeedKmh,
  formatSpeedMps,
  formatDistanceMeters,
  formatRideDistanceMeters,
  formatLengthMeters,
} from './units'

test('board km/h and GPS m/s describe the same speed in either system', () => {
  for (const units of ['km', 'mi'] as const) {
    expect(speedFromMps(10, units)).toBeCloseTo(speedFromKmh(36, units))
    expect(formatSpeedMps(10, units)).toBe(formatSpeedKmh(36, units))
    expect(speedToKmh(speedFromKmh(40, units), units)).toBeCloseTo(40)
  }
  expect(formatSpeedKmh(40, 'mi', 1)).toBe('24.9 mph')
  expect(formatSpeedKmh(40, 'km')).toBe('40 km/h')
  expect(speedFromKmh(-16.09344, 'mi')).toBeCloseTo(-10)
})

test('nearby-distance boundary and ride/fixed-length policies remain distinct', () => {
  expect(formatDistanceMeters(999, 'km')).toBe('999 m')
  expect(formatDistanceMeters(1000, 'km')).toBe('1.0 km')
  expect(formatDistanceMeters(METERS_PER_MILE * 0.1 - 0.001, 'mi')).toBe('528 ft')
  expect(formatDistanceMeters(METERS_PER_MILE * 0.1, 'mi')).toBe('0.1 mi')
  expect(formatRideDistanceMeters(METERS_PER_MILE, 'mi')).toBe('1.0 mi')
  expect(formatRideDistanceMeters(0, 'mi')).toBe('0.0 mi')
  expect(formatLengthMeters(METERS_PER_MILE, 'mi')).toBe('5280 ft')
  expect(formatLengthMeters(1000, 'km')).toBe('1000 m')
})

test('input conversion retains exact untouched values and physical bounds', () => {
  const canonical = 40.2336
  expect(speedInputToKmh(speedFromKmh(canonical, 'mi'), canonical, 'mi')).toBe(canonical)
  expect(speedInputToKmh(25, 40, 'mi')).toBeCloseTo(canonical)
  expect(speedInputToKmh(-1, 40, 'mi', 5, 150)).toBe(5)
  expect(speedInputToKmh(200, 40, 'mi', 5, 150)).toBe(150)
  expect(speedInputToKmh(speedFromKmh(150, 'mi'), 40, 'mi', 5, 150)).toBe(150)
})

test('speed display precision rounds after conversion and suppresses trailing zeros', () => {
  expect(formatSpeedValue(40, 'km')).toBe('40')
  expect(formatSpeedValue(40, 'mi')).toBe('25')
  expect(formatSpeedValue(40, 'mi', 1)).toBe('24.9')
  expect(formatSpeedValue(40.2336, 'mi', 1)).toBe('25')
  expect(formatSpeedValue(0, 'mi', 1)).toBe('0')
  expect(formatSpeedValue(-40, 'mi', 1)).toBe('-24.9')
})
