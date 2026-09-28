import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { LiveStateEvent, LocationEvent } from 'vescape-core'

import { reactNativeStub } from '../../testSetup'

const actualCore = await import('@/../modules/vescape-core/src/index')
let state: LiveStateEvent
let onLocation: (fix: LocationEvent) => void
let onAppState: (status: string) => void
let stopSync: (() => void) | undefined
let focusedSubscriptions = 0
let bmsSubscriptions = 0
let bmsFocused = false
let focusedMetrics: string[] = []
let removed = 0
let scansStopped = 0
let demandRefreshes = 0
let onLiveState: (state: LiveStateEvent) => void
const subscribe = () => ({
  remove() {
    removed += 1
  },
})
mock.module('react-native', () => ({
  ...reactNativeStub,
  AppState: {
    addEventListener: (_: string, listener: (status: string) => void) => {
      onAppState = listener
      return subscribe()
    },
  },
}))
mock.module('vescape-core', () => ({
  ...actualCore,
  getLiveState: () => state,
  addLiveStateListener: (listener: (state: LiveStateEvent) => void) => {
    onLiveState = listener
    return subscribe()
  },
  addFocusedSeriesListener: () => {
    focusedSubscriptions += 1
    return subscribe()
  },
  addBmsSeriesListener: () => {
    bmsSubscriptions += 1
    return subscribe()
  },
  setFocusedSeriesMetrics: (metrics: string[]) => {
    focusedMetrics = metrics
  },
  setBmsSeriesFocused: (focused: boolean) => {
    bmsFocused = focused
  },
  addLiveTickListener: subscribe,
  addLiveSeriesListener: subscribe,
  addBmsListener: subscribe,
  addLocationListener: (listener: (fix: LocationEvent) => void) => {
    onLocation = listener
    return subscribe()
  },
  stopScan: () => {
    scansStopped += 1
  },
  stopBoard: async () => {},
  selectBoard: async () => {},
  setSelectedBoard: () => {},
  refreshLocationDemand: () => {
    demandRefreshes += 1
  },
}))

const {
  useBleStore,
  acquireFocusedSeries,
  releaseFocusedSeries,
  acquireBmsSeriesStream,
  releaseBmsSeriesStream,
} = await import('@/modules/board/store/bleStore')
const { useLocationStore } = await import('@/modules/location/store/locationStore')
const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
const { startLiveStateSync, syncLiveState, refreshGpsDemand } = await import('./liveStateSync')
const { liveTelemetryRuntime } = await import('@/modules/board/lib/liveTelemetryRuntime')
const { deriveGpsStatusBadge } = await import('@/modules/location/lib/gpsStatusBadge')

beforeEach(() => {
  stopSync?.()
  liveTelemetryRuntime.reset()
  useLocationStore.getState().reset()
  scansStopped = 0
  demandRefreshes = 0
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
  stopSync = startLiveStateSync()
})

afterEach(() => {
  stopSync?.()
  stopSync = undefined
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
  syncLiveState()
  const current = useLocationStore.getState()
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
  syncLiveState()
  const current = useLocationStore.getState()
  expect(current.latestApproximateLocation).toEqual(fix)
  expect(
    deriveGpsStatusBadge({
      phase: current.gpsStatus,
      latestFix: current.latestApproximateLocation,
      nowMs: 10_001,
    })?.kind,
  ).toBe('weak')
})

function trailFix(timestamp: number): LocationEvent {
  return {
    latitude: 50 + timestamp / 1_000_000,
    longitude: 19,
    timestamp,
    precise: true,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: 3,
    speedMps: 4,
    bearingDeg: null,
    altitudeM: null,
  }
}

function restoreTrail() {
  const fixes = [10_000, 20_000, 30_000].map(trailFix)
  state.gps.latestFix = fixes.at(-1)!
  state.gps.latestApproximateFix = fixes.at(-1)!
  state.gps.recentLocations = fixes
  syncLiveState()
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)
  return fixes
}

for (const phase of ['connected', 'idle'] as const) {
  test(`preserves restored background trail across native status events while ${phase}`, () => {
    state.board.phase = phase
    const fixes = restoreTrail()
    // Both platforms omit history even when native retains it for getLiveState().
    const event = { ...state, gps: { ...state.gps, recentLocations: [] } }
    onLiveState(event)
    expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)

    // A latest fix arriving via status still extends the retained trail.
    const next = trailFix(40_000)
    onLiveState({ ...event, gps: { ...event.gps, latestFix: next, latestApproximateFix: next } })
    expect(useLocationStore.getState().liveLocationHistory).toEqual([...fixes, next])

    // Losing GPS accuracy updates the puck without erasing the precise trail.
    const approximate = { ...trailFix(50_000), precise: false, accuracyM: 100 }
    onLiveState({
      ...event,
      gps: { ...event.gps, latestFix: next, latestApproximateFix: approximate },
    })
    expect(useLocationStore.getState().liveLocationHistory).toEqual([...fixes, next])
    expect(useLocationStore.getState().latestApproximateLocation).toEqual(approximate)
  })
}

test('replaces the trail with authoritative native history on foreground sync', () => {
  state.board.phase = 'connected'
  const fixes = restoreTrail()
  state.gps.recentLocations = fixes.slice(1)
  syncLiveState()
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes.slice(1))

  state.gps.recentLocations = fixes.slice(2)
  syncLiveState()
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes.slice(2))
})

test('clears an old trail when a full native snapshot has no GPS state', () => {
  state.board.phase = 'connected'
  restoreTrail()
  state.gps = { ...state.gps, latestFix: null, latestApproximateFix: null, recentLocations: [] }
  syncLiveState()
  expect(useLocationStore.getState().liveLocationHistory).toEqual([])
  expect(useLocationStore.getState().latestApproximateLocation).toBeNull()
})

test('drops replay trail on teardown even when the status event has no history', () => {
  state.board.phase = 'connected'
  state.board.connectedBoardId = 'replay:test'
  restoreTrail()
  state.board = { ...state.board, phase: 'idle', connectedBoardId: null }
  state.gps = { ...state.gps, latestFix: null, latestApproximateFix: null, recentLocations: [] }
  onLiveState(state)
  expect(useLocationStore.getState().liveLocationHistory).toEqual([])
})

test('board connect, switch, and disconnect do not clear phone location or stop its stream', async () => {
  const fixes = restoreTrail()
  await useBleStore.getState().connect('board-1')
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)
  await useBleStore.getState().connect('board-2')
  await useBleStore.getState().disconnect()
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)
  const boardSnapshot = useBleStore.getState()
  const next = trailFix(40_000)
  onLocation(next)
  useLocationStore.getState().flushPending()
  expect(useLocationStore.getState().liveLocationHistory).toEqual([...fixes, next])
  expect(useBleStore.getState()).toBe(boardSnapshot)
})

test('app-root lifecycle restores background fixes and stops scanning', () => {
  const fixes = restoreTrail()
  useBleStore.setState({ scanStatus: 'scanning' })
  onAppState('background')
  expect(scansStopped).toBe(1)
  const next = trailFix(40_000)
  state.gps = { ...state.gps, recentLocations: [...fixes, next], latestFix: next }
  onAppState('active')
  expect(useLocationStore.getState().liveLocationHistory).toEqual([...fixes, next])
  onLiveState({ ...state, gps: { ...state.gps, recentLocations: [] } })
  expect(useLocationStore.getState().liveLocationHistory).toEqual([...fixes, next])
})

test('retention changes and permission refresh restore native location independently of board', () => {
  const fixes = restoreTrail()
  state.gps.recentLocations = fixes.slice(1)
  const oldLimit = useSettingsStore.getState().liveHistoryLimit
  useSettingsStore.setState({ liveHistoryLimit: oldLimit + 1 })
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes.slice(1))
  useSettingsStore.setState({ liveHistoryLimit: oldLimit })
  state.gps.recentLocations = fixes
  refreshGpsDemand()
  expect(demandRefreshes).toBe(1)
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)
})

test('entering another replay replaces its predecessor trail even without a full snapshot', () => {
  restoreTrail()
  const fix = trailFix(40_000)
  state.board.connectedBoardId = 'replay:first'
  state.gps = { ...state.gps, recentLocations: [], latestFix: fix, latestApproximateFix: fix }
  onLiveState(state)
  expect(useLocationStore.getState().liveLocationHistory).toEqual([fix])
  const other = trailFix(50_000)
  onLiveState({
    ...state,
    board: { ...state.board, connectedBoardId: 'replay:second' },
    gps: { ...state.gps, latestFix: other, latestApproximateFix: other },
  })
  expect(useLocationStore.getState().liveLocationHistory).toEqual([other])
})

test('cleanup removes native/lifecycle observers and discards a pending location publication', () => {
  const fixes = restoreTrail()
  onLocation(trailFix(40_000))
  const before = removed
  stopSync?.()
  expect(removed - before).toBeGreaterThanOrEqual(6)
  useLocationStore.getState().flushPending()
  expect(useLocationStore.getState().liveLocationHistory).toEqual(fixes)
  stopSync = undefined
})

test('native connected status exposes telemetry arrival without a full history snapshot', () => {
  expect(useBleStore.getState().lastTelemetryAt).toBeNull()
  onLiveState({ ...state, board: { ...state.board, phase: 'connected', lastTelemetryAt: 40_000 } })
  expect(useBleStore.getState().lastTelemetryAt).toBe(40_000)
  onLiveState(state)
  expect(useBleStore.getState().lastTelemetryAt).toBeNull()
})

test('an old cleanup cannot tear down a replacement synchronization owner', () => {
  const oldCleanup = stopSync!
  stopSync = startLiveStateSync()
  const before = removed
  onLocation(trailFix(40_000))
  oldCleanup()
  expect(removed).toBe(before)
  useLocationStore.getState().flushPending()
  expect(useLocationStore.getState().liveLocationHistory).toEqual([trailFix(40_000)])
})

test('restarting app synchronization restores held focused and BMS streams', () => {
  state.board.phase = 'connected'
  syncLiveState()
  acquireFocusedSeries('speed')
  acquireBmsSeriesStream()
  const focusedBefore = focusedSubscriptions
  const bmsBefore = bmsSubscriptions
  stopSync = startLiveStateSync()
  expect(focusedSubscriptions).toBe(focusedBefore + 1)
  expect(bmsSubscriptions).toBe(bmsBefore + 1)
  expect(focusedMetrics).toEqual(['speed'])
  expect(bmsFocused).toBe(true)
  releaseFocusedSeries('speed')
  releaseBmsSeriesStream()
  expect(focusedMetrics).toEqual([])
  expect(bmsFocused).toBe(false)
})
