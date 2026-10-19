import { expect, test } from 'bun:test'
import type { Navigation, RouteProgress } from 'vescape-core'
import { navigationPathShape, navigationCameraPath } from './navigationPath'

const navigation: Navigation = {
  target: { latitude: 1, longitude: 2 },
  profile: 'walking',
  computedAtMs: 1,
  status: 'ready',
  distanceMeters: 100,
  durationSeconds: 10,
  coordinates: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
}
const progress: RouteProgress = {
  latitude: 0.5,
  longitude: 1,
  segmentIndex: 1,
  segmentFraction: 0.5,
  deviationMeters: 12,
  remainingMeters: 75,
  remainingDurationSeconds: 7.5,
  bearingDeg: 0,
}

test('split uses native selected leg and shares one exact point without a gap', () => {
  const features = navigationPathShape(navigation, progress)!.features
  expect(features.map((f) => f.geometry.coordinates)).toEqual([
    [
      [0, 0],
      [1, 0],
      [1, 0.5],
    ],
    [
      [1, 0.5],
      [1, 1],
      [2, 1],
    ],
  ])
  expect(features.map((f) => f.properties?.opacity)).toEqual([0.2, 1])
  // End-of-path remaining distance includes rider-to-target fallback; it must not move the split.
  expect(navigationPathShape(navigation, { ...progress, remainingMeters: 900 })!.features).toEqual(
    features,
  )
})

test('first and last endpoints avoid an emphasized degenerate future line', () => {
  const first = navigationPathShape(navigation, {
    ...progress,
    latitude: 0,
    longitude: 0,
    segmentIndex: 0,
    segmentFraction: 0,
  })!
  expect(first.features).toHaveLength(1)
  expect(first.features[0].properties?.opacity).toBe(1)
  const last = navigationPathShape(navigation, {
    ...progress,
    latitude: 1,
    longitude: 2,
    segmentIndex: 2,
    segmentFraction: 1,
  })!
  expect(last.features).toHaveLength(1)
  expect(last.features[0].properties?.opacity).toBe(0.2)
})

test('no fix draws the usable path whole; no usable path draws nothing', () => {
  expect(navigationPathShape(navigation, null)!.features[0].geometry.coordinates).toEqual(
    navigation.coordinates,
  )
  expect(navigationPathShape({ ...navigation, status: 'fetchFailed' }, progress)).toBeNull()
})

test('map entry frames only the remaining path, excluding the passed detour', () => {
  const detour = {
    ...navigation,
    coordinates: [
      [-10, -10],
      [1, 0],
      [1, 1],
      [2, 1],
    ] as [number, number][],
  }
  const route = navigationCameraPath(detour, progress)
  expect(route).toEqual([
    [1, 0.5],
    [1, 1],
    [2, 1],
  ])
})

test('camera uses the whole path before GPS and focuses only the destination at the end', () => {
  expect(navigationCameraPath(navigation, null)).toEqual(navigation.coordinates)
  expect(
    navigationCameraPath(navigation, {
      ...progress,
      latitude: 1,
      longitude: 2,
      segmentIndex: 2,
      segmentFraction: 1,
    }),
  ).toEqual([[2, 1]])
  expect(navigationCameraPath(null, progress)).toEqual([])
})
