import { expect, test } from 'bun:test'

import {
  distanceMeters,
  nearbyRadiusMeters,
  watchRouteSpanMeters,
} from '@/modules/map/lib/nearbyRadius'

test('a closer camera asks for a smaller radius', () => {
  expect(nearbyRadiusMeters(16, 52)).toBeLessThan(nearbyRadiusMeters(12, 52))
})

/** The server refuses anything past 50km and a hair-thin radius returns nothing useful. */
test('the radius stays inside the server limits at every zoom', () => {
  expect(nearbyRadiusMeters(1, 0)).toBe(50_000)
  expect(nearbyRadiusMeters(22, 52)).toBe(500)
})

test('the same zoom covers less ground near the poles', () => {
  expect(nearbyRadiusMeters(12, 70)).toBeLessThan(nearbyRadiusMeters(12, 0))
})

test('a broken camera reading falls back to the smallest radius', () => {
  expect(nearbyRadiusMeters(Number.NaN, 52)).toBe(500)
  expect(nearbyRadiusMeters(12, Number.POSITIVE_INFINITY)).toBe(500)
})

test('distance is symmetric and zero for the same point', () => {
  const warsaw = { latitude: 52.2297, longitude: 21.0122 }
  const krakow = { latitude: 50.0647, longitude: 19.945 }

  expect(distanceMeters(warsaw, warsaw)).toBe(0)
  expect(distanceMeters(warsaw, krakow)).toBeCloseTo(distanceMeters(krakow, warsaw), 6)
  // Warsaw to Kraków is ~252km.
  expect(distanceMeters(warsaw, krakow) / 1000).toBeGreaterThan(240)
  expect(distanceMeters(warsaw, krakow) / 1000).toBeLessThan(265)
})

test('watch route span follows zoom and clamps unusable extremes', () => {
  expect(watchRouteSpanMeters(16, 52, 1080)).toBeLessThan(watchRouteSpanMeters(14, 52, 1080) ?? 0)
  expect(watchRouteSpanMeters(24, 52, 1080)).toBe(150)
  expect(watchRouteSpanMeters(1, 52, 1080)).toBe(2_000)
  expect(watchRouteSpanMeters(14, 52, 0)).toBeNull()
})

test('a hair of zoom drift asks for the same area', () => {
  // What a settling camera reports: the same view, reported to a few decimals of zoom.
  expect(nearbyRadiusMeters(15.02, 52)).toBe(nearbyRadiusMeters(15.0, 52))
  expect(nearbyRadiusMeters(12.03, 52)).toBe(nearbyRadiusMeters(12.0, 52))
})
