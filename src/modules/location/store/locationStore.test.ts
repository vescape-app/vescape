import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { LiveStateEvent, LocationEvent } from 'vescape-core'

import { createLocationStore } from './locationStore'

let store: ReturnType<typeof createLocationStore>
const WINDOW_MS = 60_000

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

function gps(overrides: Partial<LiveStateEvent['gps']> = {}): LiveStateEvent['gps'] {
  return {
    phase: 'active',
    mode: 'map',
    latestFix: null,
    latestApproximateFix: null,
    recentLocations: [],
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  store = createLocationStore()
})

afterEach(() => {
  store.getState().cancelPending()
})

test('restores native trail, precise latest fix, and newer approximate puck without a board', () => {
  store.getState().applySnapshot(
    gps({
      recentLocations: [fix(10_000)],
      latestFix: fix(20_000),
      latestApproximateFix: fix(30_000, false),
    }),
    WINDOW_MS,
  )
  expect(store.getState().liveLocationHistory).toEqual([fix(10_000), fix(20_000)])
  expect(store.getState().latestApproximateLocation).toEqual(fix(30_000, false))
  expect(store.getState().gpsStatus).toBe('active')
})

test('status events preserve background trail and merge new precise and approximate fixes', () => {
  const trail = [10_000, 20_000, 30_000].map((time) => fix(time))
  store.getState().applySnapshot(gps({ recentLocations: trail }), WINDOW_MS)
  store.getState().applyStatus(gps({ latestFix: trail.at(-1)! }), WINDOW_MS)
  expect(store.getState().liveLocationHistory).toEqual(trail)
  store
    .getState()
    .applyStatus(
      gps({ latestFix: fix(40_000), latestApproximateFix: fix(50_000, false) }),
      WINDOW_MS,
    )
  expect(store.getState().liveLocationHistory).toEqual([...trail, fix(40_000)])
  expect(store.getState().latestApproximateLocation).toEqual(fix(50_000, false))
})

test('authoritative snapshots replace history and empty snapshots clear even unpublished fixes', () => {
  store.getState().applySnapshot(gps({ recentLocations: [fix(10_000), fix(20_000)] }), WINDOW_MS)
  store.getState().ingestLocation(fix(30_000), WINDOW_MS)
  store.getState().applySnapshot(gps({ recentLocations: [fix(20_000)] }), WINDOW_MS)
  store.getState().flushPending()
  expect(store.getState().liveLocationHistory).toEqual([fix(20_000)])
  store.getState().ingestLocation(fix(40_000), WINDOW_MS)
  store.getState().applySnapshot(gps(), WINDOW_MS)
  store.getState().flushPending()
  expect(store.getState().liveLocationHistory).toEqual([])
  expect(store.getState().latestApproximateLocation).toBeNull()
})

test('coalesces a burst of native fixes into one publication within a second', async () => {
  let publications = 0
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.liveLocationHistory !== previous.liveLocationHistory) publications++
  })
  for (const time of [10_000, 20_000, 30_000]) store.getState().ingestLocation(fix(time), WINDOW_MS)
  expect(publications).toBe(0)
  await Bun.sleep(1_050)
  expect(publications).toBe(1)
  expect(store.getState().liveLocationHistory).toEqual([fix(10_000), fix(20_000), fix(30_000)])
  unsubscribe()
})

test('status publishes buffered fixes immediately and cancels the old timer', async () => {
  let publications = 0
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.liveLocationHistory !== previous.liveLocationHistory) publications++
  })
  store.getState().ingestLocation(fix(10_000), WINDOW_MS)
  store.getState().applyStatus(gps({ latestFix: fix(20_000) }), WINDOW_MS)
  expect(publications).toBe(1)
  expect(store.getState().liveLocationHistory).toEqual([fix(10_000), fix(20_000)])
  await Bun.sleep(1_050)
  expect(publications).toBe(1)
  unsubscribe()
})

test('reset removes published and pending replay points', () => {
  store.getState().applySnapshot(gps({ recentLocations: [fix(10_000)] }), WINDOW_MS)
  store.getState().ingestLocation(fix(20_000), WINDOW_MS)
  store.getState().reset()
  store.getState().flushPending()
  expect(store.getState().liveLocationHistory).toEqual([])
  expect(store.getState().latestApproximateLocation).toBeNull()
  expect(store.getState().gpsStatus).toBe('idle')
})

test('snapshot uses the current retained window when settings change', () => {
  const state = gps({ recentLocations: [fix(10_000), fix(20_000), fix(30_000)] })
  store.getState().applySnapshot(state, WINDOW_MS)
  store.getState().applySnapshot(state, 15_000)
  expect(store.getState().liveLocationHistory).toEqual([fix(20_000), fix(30_000)])
})

test('cancelPending prevents publication without discarding buffered native fixes', async () => {
  store.getState().ingestLocation(fix(10_000), WINDOW_MS)
  store.getState().cancelPending()
  await Bun.sleep(1_050)
  expect(store.getState().liveLocationHistory).toEqual([])
  store.getState().applyStatus(gps(), WINDOW_MS)
  expect(store.getState().liveLocationHistory).toEqual([fix(10_000)])
})

test('display motion bypasses trail batching and resets independently of measured fixes', () => {
  const displayMotion = {
    fromLatitude: 50,
    fromLongitude: 19,
    toLatitude: 50.001,
    toLongitude: 19.001,
    startsAtMs: 10_000,
    endsAtMs: 11_000,
  }
  store.getState().ingestLocation({ ...fix(10_000), displayMotion }, WINDOW_MS)
  expect(store.getState().displayMotion).toEqual(displayMotion)
  // The expensive trail remains batched; motion must already be available for this segment.
  expect(store.getState().liveLocationHistory).toEqual([])
  store.getState().flushPending()
  expect(store.getState().liveLocationHistory[0].latitude).toBe(50)
  store.getState().applyStatus(gps(), WINDOW_MS)
  expect(store.getState().displayMotion).toEqual(displayMotion)
  store.getState().applySnapshot(gps({ displayMotion }), WINDOW_MS)
  expect(store.getState().displayMotion).toEqual(displayMotion)
  store.getState().reset()
  expect(store.getState().displayMotion).toBeNull()
})

test('raw GPS publishes every measured fix immediately without waiting for trail or using prediction', () => {
  const first = fix(10_000)
  store.getState().ingestLocation(first, WINDOW_MS)
  expect(store.getState().latestRawLocation).toBe(first)
  expect(store.getState().liveLocationHistory).toEqual([])
  const approximate = { ...fix(11_000, false), longitude: 19.5 }
  store.getState().ingestLocation(approximate, WINDOW_MS)
  expect(store.getState().latestRawLocation).toBe(approximate)
  store.getState().ingestLocation(first, WINDOW_MS)
  expect(store.getState().latestRawLocation).toBe(approximate)
  store.getState().reset()
  expect(store.getState().latestRawLocation).toBeNull()
})

test('camera can consume each precise fix immediately even if an approximate fix arrives before trail publication', () => {
  const first = fix(10_000)
  store.getState().ingestLocation(first, WINDOW_MS)
  expect(store.getState().latestPreciseLocation).toBe(first)
  const second = { ...fix(10_500), latitude: 50.001 }
  store.getState().ingestLocation(second, WINDOW_MS)
  expect(store.getState().latestPreciseLocation).toBe(second)
  expect(store.getState().liveLocationHistory).toEqual([])
  const approximate = fix(10_600, false)
  store.getState().ingestLocation(approximate, WINDOW_MS)
  expect(store.getState().latestRawLocation).toBe(approximate)
  expect(store.getState().latestPreciseLocation).toBe(second)
  store.getState().ingestLocation(first, WINDOW_MS)
  expect(store.getState().latestPreciseLocation).toBe(second)
  store.getState().reset()
  expect(store.getState().latestPreciseLocation).toBeNull()
})

test('delayed location and status events cannot replace newer velocity motion; snapshots can reset clocks', () => {
  const motion = (startsAtMs: number) => ({
    fromLatitude: 50,
    fromLongitude: 19,
    toLatitude: 50.001,
    toLongitude: 19.001,
    startsAtMs,
    endsAtMs: startsAtMs + 1_000,
  })
  const first = motion(10_000)
  const velocityUpdate = motion(10_500)
  store.getState().ingestLocation({ ...fix(10_000), displayMotion: first }, WINDOW_MS)
  store.getState().applyStatus(gps({ displayMotion: velocityUpdate }), WINDOW_MS)
  store.getState().ingestLocation({ ...fix(9_000), displayMotion: first }, WINDOW_MS)
  expect(store.getState().displayMotion).toBe(velocityUpdate)
  expect(store.getState().latestRawLocation?.timestamp).toBe(10_000)
  store.getState().applyStatus(gps({ displayMotion: first }), WINDOW_MS)
  expect(store.getState().displayMotion).toBe(velocityUpdate)
  store.getState().applySnapshot(gps({ displayMotion: first, latestFix: fix(1_000) }), WINDOW_MS)
  expect(store.getState().displayMotion).toBe(first)
  expect(store.getState().latestRawLocation?.timestamp).toBe(1_000)
  store.getState().applyStatus(gps({ displayMotion: null }), WINDOW_MS)
  expect(store.getState().displayMotion).toBeNull()
})
