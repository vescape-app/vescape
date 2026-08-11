import { beforeEach, expect, mock, test } from 'bun:test'

import type {
  HistoryGpsSample,
  HistoryMarker,
  TelemetryMinuteBucket,
  TelemetrySample,
  TelemetrySummary,
} from 'vescape-core'
import { makeBlock as block, makeSample as sample } from '@/test-utils/factories'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const summary: TelemetrySummary = {
  sampleCount: 0,
  gpsPointCount: 0,
  firstAtMs: null,
  lastAtMs: null,
  droppedPendingSamples: 0,
}

const getTelemetryHistory = mock(async () => [] as TelemetryMinuteBucket[])
type HistoryRangeResult = {
  boardSamples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
}

const getHistoryRange = mock(
  async (): Promise<HistoryRangeResult> => ({
    boardSamples: [],
    gpsSamples: [],
    markers: [],
  }),
)
const getTelemetrySummary = mock(async () => summary)
const clearTelemetryHistory = mock(async () => {})
const deleteTelemetryRange = mock(async () => 0)
const getSettings = mock(async () => ({
  liveHistoryLimit: 5,
  autoConnect: true,
  autoRecording: true,
  selectedBoardId: null,
  lastGpsLatitude: null,
  lastGpsLongitude: null,
  movingSpeedThresholdKmh: 3,
  rideSplitGapMinutes: 30,
  freeSpinMaxSpeedDeltaKmh: 10,
  freeSpinStationaryBoardCapKmh: 15,
  mapStyleKey: 'onedark',
  satelliteOverlayEnabled: true,
  satelliteImageryOpacity: 0.2,
  satelliteMapImageryOpacity: 1,
  satelliteImagerySaturation: -0.35,
  hideTelemetryMapDetails: true,
  mapOrientationMode: 'northUp',
  historyMetricGradientsEnabled: true,
  historyMetricHotRanges: {},
}))
const updateSetting = mock(async () => {})
const wait = mock(async () => {})

const vescBleMock = {
  ...actualVescapeCore,
  getTelemetryHistory,
  getHistoryRange,
  getTelemetrySummary,
  clearTelemetryHistory,
  deleteTelemetryRange,
  getSettings,
  updateSetting,
}

mock.module('vescape-core', () => vescBleMock)
mock.module('../../modules/vescape-core/src/index', () => vescBleMock)
mock.module('@/helpers/wait', () => ({ wait }))

beforeEach(async () => {
  getTelemetryHistory.mockClear()
  getHistoryRange.mockClear()
  getTelemetrySummary.mockClear()
  clearTelemetryHistory.mockClear()
  deleteTelemetryRange.mockClear()
  getSettings.mockClear()
  updateSetting.mockClear()
  wait.mockClear()
  wait.mockImplementation(async () => {})
  const { useHistoryStore } = await import('@/modules/history/store/historyStore')
  useHistoryStore.setState({
    blocks: [],
    sessions: [],
    liveBlocks: [],
    selectedBlock: null,
    selectedSession: null,
    samples: [],
    gpsSamples: [],
    sessionSamples: [],
    sessionGpsSamples: [],
    sessionMarkers: [],
    liveSamples: [],
    liveGpsSamples: [],
    markers: [],
    summary: null,
    loading: false,
    loadingSamples: false,
    loadingSession: false,
    sessionTruncated: false,
    error: undefined,
    hasMore: true,
  })
})

test('removes selected session from history and selects next ride', async () => {
  const newest = block({
    id: 'newest',
    startAtMs: 9_000_000,
    endAtMs: 9_060_000,
  })
  const selected = block({
    id: 'selected',
    startAtMs: 5_000_000,
    endAtMs: 5_060_000,
  })
  const oldest = block({
    id: 'oldest',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
  })
  getTelemetryHistory.mockResolvedValueOnce([newest, selected, oldest])
  getTelemetryHistory.mockResolvedValueOnce([newest, oldest])

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  await useHistoryStore.getState().selectSession(useHistoryStore.getState().sessions[1])
  await (useHistoryStore.getState() as any).removeSelectedSession()

  expect(deleteTelemetryRange).toHaveBeenCalledWith({
    fromMs: selected.startAtMs,
    toMs: selected.endAtMs,
    deviceId: selected.deviceId,
  })
  expect(useHistoryStore.getState().blocks.map((b) => b.id)).toEqual(['newest', 'oldest'])
  expect(useHistoryStore.getState().sessions.map((s) => s.id)).toHaveLength(2)
  expect(useHistoryStore.getState().selectedSession?.blockIds).toEqual(['oldest'])
  expect(useHistoryStore.getState().sessionSamples).toEqual([])
  expect(useHistoryStore.getState().sessionGpsSamples).toEqual([])
  expect(useHistoryStore.getState().sessionMarkers).toEqual([])
})

test('selects ride immediately while loading its full route', async () => {
  const current = block({
    id: 'current',
    startAtMs: 5_000_000,
    endAtMs: 5_060_000,
  })
  const next = block({
    id: 'next',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
    sampleCount: 12_500,
    gpsPointCount: 4,
    firstLatitude: 51,
    firstLongitude: 17,
  })
  const currentSample = sample({ id: 10, capturedAtMs: current.startAtMs })
  getTelemetryHistory.mockResolvedValueOnce([current, next])
  getHistoryRange.mockResolvedValueOnce({
    boardSamples: [currentSample],
    gpsSamples: [],
    markers: [],
  })

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  await useHistoryStore.getState().selectSession(useHistoryStore.getState().sessions[0])

  let resolveNextRange: (value: HistoryRangeResult) => void = () => {}
  getHistoryRange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNextRange = resolve
      }),
  )

  const selectNext = useHistoryStore
    .getState()
    .selectSession(useHistoryStore.getState().sessions[1])

  expect(useHistoryStore.getState().loadingSession).toBe(true)
  expect(useHistoryStore.getState().selectedSession?.id).toBe(
    useHistoryStore.getState().sessions[1].id,
  )
  expect(useHistoryStore.getState().sessionSamples).toEqual([
    expect.objectContaining({
      capturedAtMs: next.startAtMs,
      deviceId: next.deviceId,
      latitude: next.firstLatitude,
      longitude: next.firstLongitude,
    }),
  ])
  await Promise.resolve()
  expect(getHistoryRange).toHaveBeenLastCalledWith({
    fromMs: next.startAtMs,
    toMs: next.endAtMs,
    deviceId: next.deviceId,
    limit: next.sampleCount + 1,
  })

  resolveNextRange({
    boardSamples: Array.from({ length: next.sampleCount }, (_, index) =>
      sample({ id: index + 20, capturedAtMs: next.startAtMs + index }),
    ),
    gpsSamples: Array.from({ length: next.gpsPointCount }, (_, index) => ({
      id: index + 1,
      capturedAtMs: next.startAtMs + index,
      deviceId: next.deviceId,
      deviceName: next.deviceName,
      latitude: 51 + index * 0.001,
      longitude: 17 + index * 0.001,
      speedMps: null,
      bearingDeg: null,
      accuracyM: null,
      altitudeM: null,
      timestamp: next.startAtMs + index,
      distanceFromPreviousM: null,
      precise: true,
    })),
    markers: [],
  })
  await selectNext

  expect(useHistoryStore.getState().loadingSession).toBe(false)
  expect(useHistoryStore.getState().selectedSession?.id).toBe(
    useHistoryStore.getState().sessions[1].id,
  )
  expect(useHistoryStore.getState().sessionSamples).toHaveLength(next.sampleCount)
  expect(useHistoryStore.getState().sessionTruncated).toBe(false)
})

test('loads the full route immediately but keeps loading visible for at least 150ms', async () => {
  const ride = block({
    id: 'ride',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
    firstLatitude: 51,
    firstLongitude: 17,
  })
  const fullSample = sample({ id: 42, capturedAtMs: ride.startAtMs + 1 })
  getTelemetryHistory.mockResolvedValueOnce([ride])
  getHistoryRange.mockResolvedValueOnce({
    boardSamples: [fullSample],
    gpsSamples: [],
    markers: [],
  })
  let finishMinimumLoading: () => void = () => {}
  wait.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishMinimumLoading = resolve
      }),
  )

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')
  await useHistoryStore.getState().loadInitial()

  const select = useHistoryStore.getState().selectSession(useHistoryStore.getState().sessions[0])
  await Promise.resolve()

  expect(wait).toHaveBeenCalledWith(150)
  expect(getHistoryRange).toHaveBeenCalledTimes(1)
  expect(useHistoryStore.getState().loadingSession).toBe(true)
  expect(useHistoryStore.getState().sessionSamples[0]?.id).toBe(0)

  finishMinimumLoading()
  await select

  expect(useHistoryStore.getState().loadingSession).toBe(false)
  expect(useHistoryStore.getState().sessionSamples).toEqual([fullSample])
})

test('loads a small GPS preview when selected ride has no bucket coordinate', async () => {
  const ride = block({
    id: 'ride',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
    sampleCount: 500,
    gpsPointCount: 2,
    firstLatitude: null,
    firstLongitude: null,
  })
  const previewGps: HistoryGpsSample = {
    id: 1,
    capturedAtMs: ride.startAtMs,
    deviceId: ride.deviceId,
    deviceName: ride.deviceName,
    latitude: 51,
    longitude: 17,
    speedMps: null,
    bearingDeg: null,
    accuracyM: null,
    altitudeM: null,
    timestamp: ride.startAtMs,
    distanceFromPreviousM: null,
    precise: true,
  }
  let resolvePreviewRange: (value: HistoryRangeResult) => void = () => {}
  let resolveFullRange: (value: HistoryRangeResult) => void = () => {}
  getHistoryRange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePreviewRange = resolve
      }),
  )
  getHistoryRange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFullRange = resolve
      }),
  )

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  const select = useHistoryStore.getState().selectSession({
    deviceId: ride.deviceId,
    deviceName: ride.deviceName,
    boundaryBefore: ride.boundaryBefore,
    startAtMs: ride.startAtMs,
    endAtMs: ride.endAtMs,
    movingStartAtMs: ride.firstMovingAtMs,
    movingEndAtMs: ride.lastMovingAtMs,
    blockIds: [ride.id],
    blockCount: 1,
    sampleCount: ride.sampleCount,
    gpsPointCount: ride.gpsPointCount,
    preciseGpsPointCount: ride.preciseGpsPointCount,
    distanceM: ride.distanceDeltaM,
    maxSpeedKmh: ride.maxAbsSpeedKmh,
    avgSpeedKmh: ride.avgSpeedKmh,
    maxTempMosfet: ride.maxTempMosfet,
    maxTempMotor: ride.maxTempMotor,
    maxDuty: ride.maxDuty,
    batteryUsedWh: ride.batteryUsedWh,
    batteryRegenWh: ride.batteryRegenWh,
    firstLatitude: null,
    firstLongitude: null,
    centerLatitude: null,
    centerLongitude: null,
    minLatitude: null,
    maxLatitude: null,
    minLongitude: null,
    maxLongitude: null,
    faultCount: ride.faultCount,
    id: `${ride.deviceId}:${ride.startAtMs}:${ride.endAtMs}`,
  })
  await Promise.resolve()

  expect(getHistoryRange).toHaveBeenNthCalledWith(1, {
    fromMs: ride.startAtMs,
    toMs: ride.endAtMs,
    deviceId: ride.deviceId,
    limit: 240,
  })
  expect(getHistoryRange).toHaveBeenCalledTimes(1)

  resolvePreviewRange({
    boardSamples: [],
    gpsSamples: [previewGps],
    markers: [],
  })
  await Promise.resolve()
  await Promise.resolve()

  expect(useHistoryStore.getState().sessionGpsSamples).toEqual([previewGps])
  expect(getHistoryRange).toHaveBeenCalledTimes(2)

  resolveFullRange({
    boardSamples: Array.from({ length: ride.sampleCount }, (_, index) =>
      sample({ id: index + 1, capturedAtMs: ride.startAtMs + index }),
    ),
    gpsSamples: [previewGps, { ...previewGps, id: 2, capturedAtMs: ride.startAtMs + 1 }],
    markers: [],
  })
  await select

  expect(useHistoryStore.getState().loadingSession).toBe(false)
  expect(useHistoryStore.getState().sessionTruncated).toBe(false)
})

test('loads older history pages and merges sessions', async () => {
  const newest = block({
    id: 'newest',
    startAtMs: 9_000_000,
    endAtMs: 9_060_000,
  })
  const oldestLoaded = block({
    id: 'oldest-loaded',
    startAtMs: 5_000_000,
    endAtMs: 5_060_000,
  })
  const older = block({
    id: 'older',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
  })
  getTelemetryHistory.mockResolvedValueOnce([newest, oldestLoaded])
  getTelemetryHistory.mockResolvedValueOnce([older])

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  useHistoryStore.setState({ hasMore: true })
  await useHistoryStore.getState().loadMore()

  expect((getTelemetryHistory.mock.calls as any[])[1][0]).toEqual({
    limit: 100,
    cursorBeforeMs: oldestLoaded.bucketStartMs - 1,
  })
  expect(useHistoryStore.getState().blocks.map((b) => b.id)).toEqual([
    'newest',
    'oldest-loaded',
    'older',
  ])
  expect(useHistoryStore.getState().sessions.map((s) => s.blockIds)).toEqual([
    ['newest'],
    ['oldest-loaded'],
    ['older'],
  ])
  expect(useHistoryStore.getState().hasMore).toBe(false)
})

test('keeps selected session addressable when older page expands it', async () => {
  const newest = block({
    id: 'newest',
    startAtMs: 9_000_000,
    endAtMs: 9_060_000,
  })
  const partial = block({
    id: 'partial',
    startAtMs: 5_000_000,
    endAtMs: 5_060_000,
  })
  const olderSameRide = block({
    id: 'older-same-ride',
    startAtMs: 4_960_000,
    endAtMs: 4_999_000,
  })
  getTelemetryHistory.mockResolvedValueOnce([newest, partial])
  getTelemetryHistory.mockResolvedValueOnce([olderSameRide])

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  useHistoryStore.setState({
    hasMore: true,
    selectedSession: useHistoryStore.getState().sessions[1],
  })
  await useHistoryStore.getState().loadMore()

  expect(useHistoryStore.getState().sessions).toHaveLength(2)
  expect(useHistoryStore.getState().selectedSession?.startAtMs).toBe(4_960_000)
  expect(useHistoryStore.getState().selectedSession?.endAtMs).toBe(5_060_000)
})

test('clearHistory invalidates an in-flight live refresh', async () => {
  const stale = block({
    id: 'stale',
    startAtMs: 1_000_000,
    endAtMs: 1_060_000,
  })
  let resolveRefresh: (blocks: TelemetryMinuteBucket[]) => void = () => {}
  getTelemetryHistory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
  )
  getTelemetryHistory.mockResolvedValueOnce([])
  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  const refresh = useHistoryStore.getState().refreshLive()
  await Promise.resolve()
  await useHistoryStore.getState().clearHistory()
  resolveRefresh([stale])
  await refresh

  expect(useHistoryStore.getState().blocks).toEqual([])
  expect(useHistoryStore.getState().liveBlocks).toEqual([])
})
