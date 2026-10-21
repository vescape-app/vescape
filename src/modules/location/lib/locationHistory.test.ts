import { expect, test } from 'bun:test'
import type { LocationEvent } from 'vescape-core'

import { appendLocation, createLocationHistory } from './locationHistory'

function fix(timestamp: number, precise = true): LocationEvent {
  return {
    latitude: 50,
    longitude: 19,
    timestamp,
    precise,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: precise ? 3 : 100,
    speedMps: null,
    bearingDeg: null,
    altitudeM: null,
  }
}

test('orders fixes, deduplicates timestamps, and prunes late arrivals against the newest fix', () => {
  const history = createLocationHistory()
  for (const timestamp of [11_000, 5_000, 0, 5_000, 1_000]) {
    appendLocation(history, fix(timestamp), 10_000)
  }
  expect(history.locations.map((location) => location.timestamp)).toEqual([1_000, 5_000, 11_000])
  expect(history.latestApproximateLocation).toEqual(fix(11_000))
})

test('updates the puck from approximate fixes while keeping only precise fixes in the trail', () => {
  const history = createLocationHistory()
  appendLocation(history, fix(1_000), 10_000)
  appendLocation(history, fix(3_000, false), 10_000)
  appendLocation(history, fix(2_000), 10_000)
  expect(history.locations).toEqual([fix(1_000), fix(2_000)])
  expect(history.latestApproximateLocation).toEqual(fix(3_000, false))
})

test('a later precise fix can add a trail point at an approximate fix timestamp', () => {
  const history = createLocationHistory()
  appendLocation(history, fix(1_000, false), 10_000)
  appendLocation(history, fix(1_000), 10_000)
  expect(history.locations).toEqual([fix(1_000)])
})
