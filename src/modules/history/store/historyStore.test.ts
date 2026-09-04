import { beforeEach, expect, mock, test } from 'bun:test'

import type {
  HistoryGpsSample,
  HistoryMarker,
  RideHistoryPage,
  RideHistorySession,
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
const getRideHistoryPage = mock(async () => ridePage([]))

function ridePage(buckets: TelemetryMinuteBucket[], hasMore = false): RideHistoryPage {
  return {
    sessions: buckets.map(sessionFromBucket),
    hasMore,
    nextCursorBeforeMs: hasMore ? Math.min(...buckets.map((item) => item.bucketStartMs)) : null,
  }
}

function sessionFromBucket(bucket: TelemetryMinuteBucket): RideHistorySession {
  const point =
    bucket.firstLatitude != null && bucket.firstLongitude != null
      ? [{ latitude: bucket.firstLatitude, longitude: bucket.firstLongitude }]
      : []
  return {
    id: `${bucket.boardId ?? 'unknown'}:${bucket.startAtMs}:${bucket.endAtMs}`,
    boardId: bucket.boardId,
    boardName: bucket.boardName,
    startAtMs: bucket.startAtMs,
    endAtMs: bucket.endAtMs,
    movingStartAtMs: bucket.firstMovingAtMs,
    movingEndAtMs: bucket.lastMovingAtMs,
    blockIds: [bucket.id],
    blockCount: 1,
    sampleCount: bucket.sampleCount,
    gpsPointCount: bucket.gpsPointCount,
    preciseGpsPointCount: bucket.preciseGpsPointCount,
    distanceM: bucket.distanceDeltaM ?? bucket.gpsDistanceM,
    maxSpeedKmh: bucket.maxAbsSpeedKmh,
    avgSpeedKmh: bucket.avgSpeedKmh,
    maxTempMosfet: bucket.maxTempMosfet,
    maxTempMotor: bucket.maxTempMotor,
    maxDuty: bucket.maxDuty,
    batteryUsedWh: bucket.batteryUsedWh,
    batteryRegenWh: bucket.batteryRegenWh,
    firstLatitude: bucket.firstLatitude,
    firstLongitude: bucket.firstLongitude,
    centerLatitude: bucket.firstLatitude,
    centerLongitude: bucket.firstLongitude,
    minLatitude: bucket.firstLatitude,
    maxLatitude: bucket.firstLatitude,
    minLongitude: bucket.firstLongitude,
    maxLongitude: bucket.firstLongitude,
    boundaryBefore: bucket.boundaryBefore,
    routePoints: point,
  }
}
interface HistoryRangeResult {
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
  getRideHistoryPage,
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
  getRideHistoryPage.mockClear()
  getRideHistoryPage.mockImplementation(async () => ridePage([]))
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
    selectedBlock: null,
    selectedSession: null,
    samples: [],
    gpsSamples: [],
    sessionSamples: [],
    sessionGpsSamples: [],
    sessionMarkers: [],
    markers: [],
    summary: null,
    loading: false,
    loadingSamples: false,
    loadingSession: false,
    sessionTruncated: false,
    error: undefined,
    hasMore: true,
    nextCursorBeforeMs: null,
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
  getRideHistoryPage.mockResolvedValueOnce(ridePage([newest, selected, oldest]))
  getRideHistoryPage.mockResolvedValueOnce(ridePage([newest, oldest]))

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  await useHistoryStore.getState().selectSession(useHistoryStore.getState().sessions[1])
  await useHistoryStore.getState().removeSelectedSession()

  expect(deleteTelemetryRange).toHaveBeenCalledWith({
    fromMs: selected.startAtMs,
    toMs: selected.endAtMs,
    boardId: selected.boardId,
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
    // Known geography, so selecting it takes one range call and no GPS preview.
    firstLatitude: 52,
    firstLongitude: 18,
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
  getRideHistoryPage.mockResolvedValueOnce(ridePage([current, next]))
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
  // Samples never outlive the ride they belong to: the charts would otherwise rebuild the whole
  // previous dataset against the new ride's bounds while the real samples are still loading.
  expect(useHistoryStore.getState().sessionSamples).toEqual([])
  await Promise.resolve()
  expect(getHistoryRange).toHaveBeenLastCalledWith({
    fromMs: next.startAtMs,
    toMs: next.endAtMs,
    boardId: next.boardId,
    limit: next.sampleCount + 1,
  })

  resolveNextRange({
    boardSamples: Array.from({ length: next.sampleCount }, (_, index) =>
      sample({ id: index + 20, capturedAtMs: next.startAtMs + index }),
    ),
    gpsSamples: Array.from({ length: next.gpsPointCount }, (_, index) => ({
      id: index + 1,
      capturedAtMs: next.startAtMs + index,
      boardId: next.boardId,
      boardName: next.boardName,
      latitude: 51 + index * 0.001,
      longitude: 17 + index * 0.001,
      speedMps: null,
      bearingDeg: null,
      accuracyM: null,
      altitudeM: null,
      timestamp: next.startAtMs + index,
      distanceFromPreviousM: null,
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
  getRideHistoryPage.mockResolvedValueOnce(ridePage([ride]))
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
  expect(useHistoryStore.getState().sessionSamples).toEqual([])

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
    preciseGpsPointCount: 2,
    firstLatitude: null,
    firstLongitude: null,
  })
  const previewGps: HistoryGpsSample = {
    id: 1,
    capturedAtMs: ride.startAtMs,
    boardId: ride.boardId,
    boardName: ride.boardName,
    latitude: 51,
    longitude: 17,
    speedMps: null,
    bearingDeg: null,
    accuracyM: null,
    altitudeM: null,
    timestamp: ride.startAtMs,
    distanceFromPreviousM: null,
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
    boardId: ride.boardId,
    boardName: ride.boardName,
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
    routePoints: [],
    id: `${ride.boardId}:${ride.startAtMs}:${ride.endAtMs}`,
  })
  await Promise.resolve()

  expect(getHistoryRange).toHaveBeenNthCalledWith(1, {
    fromMs: ride.startAtMs,
    toMs: ride.endAtMs,
    boardId: ride.boardId,
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
  getRideHistoryPage.mockResolvedValueOnce(ridePage([newest, oldestLoaded], true))
  getRideHistoryPage.mockResolvedValueOnce(ridePage([older]))

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  await useHistoryStore.getState().loadMore()

  expect((getRideHistoryPage.mock.calls as unknown[][])[1][0]).toEqual({
    limit: 10,
    cursorBeforeMs: oldestLoaded.bucketStartMs,
  })
  expect(useHistoryStore.getState().blocks.map((b) => b.id)).toEqual(['newest', 'oldest-loaded'])
  expect(useHistoryStore.getState().sessions.map((s) => s.blockIds)).toEqual([
    ['newest'],
    ['oldest-loaded'],
    ['older'],
  ])
  expect(useHistoryStore.getState().hasMore).toBe(false)
})

test('loads complete ride pages without changing an already visible ride', async () => {
  const newest = block({ id: 'newest', startAtMs: 10_000_000 })
  const middle = block({ id: 'middle', startAtMs: 5_000_000 })
  const older = Array.from({ length: 10 }, (_, index) =>
    block({ id: `older-${index}`, startAtMs: 4_000_000 - index * 2_000_000 }),
  )
  getTelemetryHistory.mockResolvedValueOnce([newest, middle])
  getRideHistoryPage.mockResolvedValueOnce(ridePage([newest, middle], true))
  getRideHistoryPage.mockResolvedValueOnce(ridePage(older))

  const { useHistoryStore } = await import('@/modules/history/store/historyStore')

  await useHistoryStore.getState().loadInitial()
  const visibleBefore = useHistoryStore
    .getState()
    .sessions.map(({ id, startAtMs, endAtMs }) => ({ id, startAtMs, endAtMs }))

  expect(visibleBefore).toHaveLength(2)
  useHistoryStore.setState({ selectedSession: useHistoryStore.getState().sessions[1] })
  const selectedBefore = useHistoryStore.getState().selectedSession

  await useHistoryStore.getState().loadMore()
  const visibleAfter = useHistoryStore
    .getState()
    .sessions.map(({ id, startAtMs, endAtMs }) => ({ id, startAtMs, endAtMs }))

  expect(getRideHistoryPage).toHaveBeenCalledTimes(2)
  expect(visibleAfter.slice(0, visibleBefore.length)).toEqual(visibleBefore)
  expect(visibleAfter.length - visibleBefore.length).toBeGreaterThanOrEqual(10)
  expect(useHistoryStore.getState().selectedSession).toEqual(selectedBefore)
})

test('clearHistory invalidates an in-flight recent refresh', async () => {
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

  const refresh = useHistoryStore.getState().refreshRecent()
  await Promise.resolve()
  await useHistoryStore.getState().clearHistory()
  resolveRefresh([stale])
  await refresh

  expect(useHistoryStore.getState().blocks).toEqual([])
})

test('refreshRecent follows the growing ride and clears a stale error', async () => {
  const started = block({ id: 'live', startAtMs: 2_000_000, endAtMs: 2_060_000 })
  const grown = block({ id: 'live', startAtMs: 2_000_000, endAtMs: 2_180_000 })
  getRideHistoryPage.mockImplementation(async () => ridePage([started]))
  const { useHistoryStore } = await import('@/modules/history/store/historyStore')
  await useHistoryStore.getState().loadInitial()
  const selected = useHistoryStore.getState().sessions[0]
  useHistoryStore.setState({ selectedSession: selected, error: 'stale failure' })

  getRideHistoryPage.mockImplementation(async () => ridePage([grown]))
  await useHistoryStore.getState().refreshRecent()

  expect(useHistoryStore.getState().selectedSession?.endAtMs).toBe(2_180_000)
  expect(useHistoryStore.getState().selectedSession?.id).not.toBe(selected.id)
  expect(useHistoryStore.getState().error).toBeUndefined()
})
