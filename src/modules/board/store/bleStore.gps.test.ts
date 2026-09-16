import { beforeEach, expect, mock, test } from 'bun:test'
import type { LiveStateEvent, LocationEvent } from 'vescape-core'

const actualCore = await import('@/../modules/vescape-core/src/index')
let state: LiveStateEvent
const subscribe = () => ({ remove() {} })
mock.module('vescape-core', () => ({
  ...actualCore,
  getLiveState: () => state,
  addLiveStateListener: subscribe,
  addLiveTickListener: subscribe,
  addLiveSeriesListener: subscribe,
  addBmsListener: subscribe,
  addLocationListener: subscribe,
}))

const { useBleStore } = await import('./bleStore')
const { liveTelemetryRuntime } = await import('../lib/liveTelemetryRuntime')
const { deriveGpsStatusBadge } = await import('../lib/gpsStatusBadge')

beforeEach(() => {
  liveTelemetryRuntime.reset()
  state = {
    board: {
      phase: 'idle',
      selectedBoardId: null,
      connectedBoardId: null,
      bleId: null,
      name: null,
      connectionSeq: 0,
      lastTelemetryAt: null,
      recentTelemetry: [],
      error: null,
      autoConnect: false,
      linkIntegrity: 'unknown',
      remoteTilt: null,
    },
    gps: { phase: 'active', mode: 'map', latestFix: null, recentLocations: [], error: null },
    scan: { phase: 'idle', devices: [], error: null },
    recording: { enabled: false, paused: false, activeBoardId: null, startedAt: null },
  }
})

test('recovers a GPS fix delivered before JS subscribed without a connected board', () => {
  const fix: LocationEvent = {
    latitude: 50,
    longitude: 19,
    timestamp: 10_000,
    precise: true,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: 3,
    speedMps: null,
    bearingDeg: null,
    altitudeM: null,
  }
  state.gps.latestFix = fix
  state.gps.latestApproximateFix = fix
  state.gps.recentLocations = [fix]
  useBleStore.getState().syncNativeState()
  const current = useBleStore.getState()
  expect(
    deriveGpsStatusBadge({
      phase: current.gpsStatus,
      latestFix: current.latestApproximateLocation,
      nowMs: 10_001,
    }),
  ).toBeNull()
  expect(current.latestApproximateLocation).toEqual(fix)
})

test('recovers an approximate fix before native has any precise GPS history', () => {
  const fix: LocationEvent = {
    latitude: 50,
    longitude: 19,
    timestamp: 10_000,
    precise: false,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: 100,
    speedMps: null,
    bearingDeg: null,
    altitudeM: null,
  }
  state.gps.latestApproximateFix = fix
  useBleStore.getState().syncNativeState()
  const current = useBleStore.getState()
  expect(current.latestApproximateLocation).toEqual(fix)
  expect(
    deriveGpsStatusBadge({
      phase: current.gpsStatus,
      latestFix: current.latestApproximateLocation,
      nowMs: 10_001,
    })?.kind,
  ).toBe('weak')
})
