import type { EventSubscription } from 'expo-modules-core'

import type {
  AppSettings,
  Board,
  CompanionPresenceBoard,
  BoardProbeProgressEvent,
  BoardProbeResult,
  DeviceFoundEvent,
  HistoryGpsSample,
  HistoryMarker,
  LiveSeriesEvent,
  LiveStateEvent,
  MetricExclusion,
  PrivacyZone,
  TelemetryEvent,
  TelemetryHistoryEvent,
  TelemetryHistoryOptions,
  TelemetryMinuteBucket,
  TelemetrySample,
  TelemetrySummary,
} from './index'

const E2E_BOARD_SCAN_RESULT: DeviceFoundEvent = {
  id: 'E2:E2:E2:E2:E2:01',
  name: 'E2E VESC Board',
  rssi: -48,
  serviceUUIDs: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
}

let scanActive = false
let scanTimer: ReturnType<typeof setTimeout> | null = null
let selectedBoardId: string | null = null
let connectedBoardId: string | null = null
let connectingBoardId: string | null = null
let connectionSeq = 0
let lastTelemetry: TelemetryEvent | null = null
let connectTimer: ReturnType<typeof setTimeout> | null = null
let telemetryTimer: ReturnType<typeof setInterval> | null = null

const deviceListeners = new Set<(event: DeviceFoundEvent) => void>()
const liveStateListeners = new Set<(event: LiveStateEvent) => void>()
const liveTickListeners = new Set<(event: TelemetryEvent) => void>()
const liveSeriesListeners = new Set<(event: LiveSeriesEvent) => void>()
const telemetryHistoryListeners = new Set<(event: TelemetryHistoryEvent) => void>()
const boardProbeProgressListeners = new Set<(event: BoardProbeProgressEvent) => void>()

const e2eBoards: Board[] = []
const e2eCompanionBoardIds = new Set<string>()

const e2eSettings: AppSettings = {
  liveHistoryLimit: 1000,
  autoConnect: true,
  autoRecording: false,
  selectedBoardId: null,
  lastGpsLatitude: null,
  lastGpsLongitude: null,
  directionPointLatitude: null,
  directionPointLongitude: null,
  movingSpeedThresholdKmh: 5,
  freeSpinMaxSpeedDeltaKmh: 3,
  freeSpinStationaryBoardCapKmh: 1,
  rideSplitGapMinutes: 30,
  mapStyleKey: 'onedark',
  satelliteOverlayEnabled: true,
  satelliteImageryOpacity: 0.2,
  satelliteMapImageryOpacity: 1,
  satelliteImagerySaturation: -0.35,
  hideTelemetryMapDetails: true,
  mapOrientationMode: 'gpsHeading',
  historyMetricGradientsEnabled: true,
  historyMetricHotRanges: {},
  socEstimateWindowSeconds: 20,
  boardMoveStrengthPercent: 60,
  connectionSoundsEnabled: true,
  companionPresenceEnabled: false,
  boardWarningsEnabled: true,
  companionPresenceCooldownMinutes: 60,
  autoCloseEnabled: false,
  autoCloseDelayMinutes: 15,
  telemetryPollRateHz: 20,
  wearPushRateHz: 4,
  wearAutoLaunchOnConnect: true,
  wearNavArrowEnabled: false,
  riderId: null,
  riderName: null,
  riderColor: null,
  legalPolicy: null,
  dismissedCommunityMessageIds: [],
}

function emitDevice(event: DeviceFoundEvent): void {
  for (const listener of deviceListeners) {
    listener(event)
  }
}

function clearScanTimer(): void {
  if (!scanTimer) return
  clearTimeout(scanTimer)
  scanTimer = null
}

function clearConnectTimer(): void {
  if (!connectTimer) return
  clearTimeout(connectTimer)
  connectTimer = null
}

function makeTelemetry(): TelemetryEvent {
  const now = Date.now()
  const wobble = Math.sin(now / 1000)
  return {
    hasFault: false,
    faultCode: 0,
    pitch: wobble * 3,
    roll: wobble,
    balancePitch: wobble * 2,
    balanceCurrent: 0.6,
    speed: 12 + wobble,
    batteryVoltage: 75.6,
    batteryPercent: 75,
    motorCurrent: 8 + wobble,
    batteryCurrent: -3.4,
    erpm: 2400,
    dutyCycle: 0.18,
    state: 0,
    stateName: 'RUNNING',
    switchState: 0,
    adc1: 1.2,
    adc2: 1.1,
    odometer: 1234,
    tempMosfet: 36,
    tempMotor: 33,
    avgLatency: 18,
    pullRateHz: 20,
    lastPacketAt: now,
  }
}

function getLiveState(): LiveStateEvent {
  const connected = connectedBoardId != null
  const connecting = connectingBoardId != null
  return {
    board: {
      phase: connecting ? 'connecting' : connected ? 'connected' : 'idle',
      selectedBoardId,
      connectedBoardId,
      bleId: connected || connecting ? E2E_BOARD_SCAN_RESULT.id : null,
      name: connected || connecting ? E2E_BOARD_SCAN_RESULT.name : null,
      connectionSeq,
      lastTelemetryAt: lastTelemetry?.lastPacketAt ?? null,
      recentTelemetry: lastTelemetry ? [lastTelemetry] : [],
      error: null,
      autoConnect: true,
      linkIntegrity: connected ? 'trusted' : 'unknown',
      remoteTilt: null,
    },
    gps: {
      phase: 'idle',
      latestFix: null,
      latestApproximateFix: null,
      latestPreciseFix: null,
      recentLocations: [],
      error: null,
    },
    scan: {
      phase: scanActive ? 'scanning' : 'idle',
      devices: scanActive ? [E2E_BOARD_SCAN_RESULT] : [],
      error: null,
    },
    recording: {
      enabled: false,
      paused: false,
      activeBoardId: connected ? connectedBoardId : null,
      startedAt: null,
    },
  }
}

function emitLiveState(): void {
  const state = getLiveState()
  for (const listener of liveStateListeners) {
    listener(state)
  }
}

function clearTelemetryTimer(): void {
  if (!telemetryTimer) return
  clearInterval(telemetryTimer)
  telemetryTimer = null
}

function emitTelemetry(): void {
  if (!connectedBoardId) return
  lastTelemetry = makeTelemetry()
  for (const listener of liveTickListeners) {
    listener(lastTelemetry)
  }
  const batch: TelemetryHistoryEvent = { samples: [lastTelemetry] }
  for (const listener of telemetryHistoryListeners) {
    listener(batch)
  }
  emitLiveSeries(lastTelemetry)
  emitLiveState()
}

function emitLiveSeries(sample: TelemetryEvent): void {
  if (liveSeriesListeners.size === 0) return
  const ts = sample.lastPacketAt
  const point = (v: number | null | undefined): number[] =>
    v == null || !Number.isFinite(v) ? [] : [ts, v]
  const abs = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) ? null : Math.abs(v)
  const event: LiveSeriesEvent = {
    metrics: {
      motorTemp: sample.tempMotor != null && sample.tempMotor > 0 ? [ts, sample.tempMotor] : [],
      controllerTemp: point(sample.tempMosfet),
      motorCurrent: point(sample.motorCurrent),
      batteryCurrent: point(sample.batteryCurrent),
      batteryVoltage: point(sample.batteryVoltage),
      batteryPercent: point(sample.batteryPercent),
      speed: point(abs(sample.speed)),
      duty: point(abs(sample.dutyCycle) == null ? null : (abs(sample.dutyCycle) as number) * 100),
      // Detail-chart-only metrics (mirrors LIVE_SERIES_METRICS on native).
      pitch: point(sample.pitch),
      roll: point(sample.roll),
      balancePitch: point(sample.balancePitch),
      footpadAdc1: point(sample.adc1),
      footpadAdc2: point(sample.adc2),
    },
    generation: connectionSeq,
  }
  for (const listener of liveSeriesListeners) {
    listener(event)
  }
}

function startBoardSession(boardId: string): void {
  selectedBoardId = boardId
  connectingBoardId = boardId
  connectedBoardId = null
  lastTelemetry = null
  scanActive = false
  clearScanTimer()
  clearConnectTimer()
  clearTelemetryTimer()
  emitLiveState()
  connectTimer = setTimeout(() => {
    connectTimer = null
    connectedBoardId = boardId
    connectingBoardId = null
    connectionSeq += 1
    emitTelemetry()
    telemetryTimer = setInterval(emitTelemetry, 1000)
  }, 3000)
}

function stopBoardSession(): void {
  connectingBoardId = null
  connectedBoardId = null
  lastTelemetry = null
  clearConnectTimer()
  clearTelemetryTimer()
  emitLiveState()
}

// ---------------------------------------------------------------------------
// Telemetry history fake storage
// ---------------------------------------------------------------------------
const SAMPLE_COLUMN_COUNT = 25

let nextHistorySampleId = 1
let nextHistoryGpsId = 1
let nextHistoryMarkerId = 1
let telemetryHistory: TelemetryMinuteBucket[] = []
let historySamples: TelemetrySample[] = []
let historyGps: HistoryGpsSample[] = []
let historyMarkers: HistoryMarker[] = []
let historyExclusions: MetricExclusion[] = []

let e2ePrivacyZones: PrivacyZone[] = []

function clearTelemetryHistory(): void {
  telemetryHistory = []
  historySamples = []
  historyGps = []
  historyMarkers = []
  historyExclusions = []
  nextHistorySampleId = 1
  nextHistoryGpsId = 1
  nextHistoryMarkerId = 1
}

function getTelemetryHistory(options: TelemetryHistoryOptions): TelemetryMinuteBucket[] {
  let buckets = [...telemetryHistory].sort((a, b) => b.bucketStartMs - a.bucketStartMs)
  if (options.fromMs != null) {
    buckets = buckets.filter((b) => b.endAtMs >= options.fromMs!)
  }
  if (options.toMs != null) {
    buckets = buckets.filter((b) => b.startAtMs <= options.toMs!)
  }
  if (options.deviceId != null) {
    buckets = buckets.filter((b) => b.deviceId === options.deviceId)
  }
  if (options.cursorBeforeMs != null) {
    buckets = buckets.filter((b) => b.bucketStartMs < options.cursorBeforeMs!)
  }
  if (options.limit != null && options.limit > 0) {
    buckets = buckets.slice(0, options.limit)
  }
  return buckets
}

function encodeBoardSamples(samples: TelemetrySample[]): {
  boardColumns: ArrayBuffer
  boardCount: number
  boardDevices: (string | null)[]
  boardDeviceNames: string[]
} {
  const lanes = new Float64Array(samples.length * SAMPLE_COLUMN_COUNT)
  const boardDevices: (string | null)[] = []
  const boardDeviceNames: string[] = []
  const deviceIndexMap = new Map<string | null, number>()
  function deviceIndex(deviceId: string | null, deviceName: string): number {
    const key = `${deviceId ?? ''}:${deviceName}`
    let index = deviceIndexMap.get(key)
    if (index == null) {
      index = boardDevices.length
      boardDevices.push(deviceId)
      boardDeviceNames.push(deviceName)
      deviceIndexMap.set(key, index)
    }
    return index
  }

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const o = i * SAMPLE_COLUMN_COUNT
    lanes[o + 0] = s.id
    lanes[o + 1] = s.capturedAtMs
    lanes[o + 2] = deviceIndex(s.deviceId, s.deviceName)
    lanes[o + 3] = s.speedKmh
    lanes[o + 4] = s.batteryVoltage
    lanes[o + 5] = s.batteryPercent ?? NaN
    lanes[o + 6] = s.motorCurrent
    lanes[o + 7] = s.batteryCurrent
    lanes[o + 8] = s.dutyCycle
    lanes[o + 9] = s.pitch
    lanes[o + 10] = s.roll
    lanes[o + 11] = s.balancePitch
    lanes[o + 12] = s.balanceCurrent
    lanes[o + 13] = s.erpm
    lanes[o + 14] = s.state
    lanes[o + 15] = s.switchState
    lanes[o + 16] = s.adc1
    lanes[o + 17] = s.adc2
    lanes[o + 18] = s.odometer ?? NaN
    lanes[o + 19] = s.tempMosfet ?? NaN
    lanes[o + 20] = s.tempMotor ?? NaN
    lanes[o + 21] = s.hasFault ? 1 : 0
    lanes[o + 22] = s.faultCode
    lanes[o + 23] = s.latitude ?? NaN
    lanes[o + 24] = s.longitude ?? NaN
  }

  return {
    boardColumns: lanes.buffer,
    boardCount: samples.length,
    boardDevices,
    boardDeviceNames,
  }
}

function getHistoryRange(options: {
  fromMs: number
  toMs: number
  deviceId?: string
  limit?: number
}): {
  boardColumns: ArrayBuffer
  boardCount: number
  boardDevices: (string | null)[]
  boardDeviceNames: string[]
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  exclusions: MetricExclusion[]
} {
  let samples = historySamples.filter(
    (s) => s.capturedAtMs >= options.fromMs && s.capturedAtMs <= options.toMs,
  )
  if (options.deviceId != null) {
    samples = samples.filter((s) => s.deviceId === options.deviceId)
  }
  if (options.limit != null && options.limit > 0) {
    samples = samples.slice(0, options.limit)
  }

  let gps = historyGps.filter(
    (g) => g.capturedAtMs >= options.fromMs && g.capturedAtMs <= options.toMs,
  )
  if (options.deviceId != null) {
    gps = gps.filter((g) => g.deviceId === options.deviceId)
  }

  let markers = historyMarkers.filter(
    (m) => m.occurredAtMs >= options.fromMs && m.occurredAtMs <= options.toMs,
  )
  if (options.deviceId != null) {
    markers = markers.filter((m) => m.deviceId === options.deviceId)
  }

  const encoded = encodeBoardSamples(samples)
  return {
    ...encoded,
    gpsSamples: gps,
    markers,
    exclusions: historyExclusions,
  }
}

function getTelemetrySummary(): TelemetrySummary {
  return {
    sampleCount: historySamples.length,
    gpsPointCount: historyGps.length,
    firstAtMs: historySamples[0]?.capturedAtMs ?? null,
    lastAtMs: historySamples.at(-1)?.capturedAtMs ?? null,
    droppedPendingSamples: 0,
  }
}

interface RideSeed {
  startOffsetMs: number
  durationMs: number
  distanceM: number
  maxSpeedKmh: number
  avgSpeedKmh: number
  maxTempMosfet: number
  maxTempMotor: number
  batteryUsedWh: number
  batteryRegenWh: number
  startLatitude: number
  startLongitude: number
}

function seedHistoryData(deviceId: string, deviceName: string): void {
  clearTelemetryHistory()
  const now = Date.now()

  const rides: RideSeed[] = [
    {
      // Older ride, selected by pressing "previous" from the newest ride.
      startOffsetMs: -2 * 60 * 60_000,
      durationMs: 5 * 60_000,
      distanceM: 800,
      maxSpeedKmh: 20,
      avgSpeedKmh: 14,
      maxTempMosfet: 34,
      maxTempMotor: 32,
      batteryUsedWh: 7,
      batteryRegenWh: 0.5,
      startLatitude: 51.0979,
      startLongitude: 17.0285,
    },
    {
      // Newest ride, selected automatically when entering history mode.
      startOffsetMs: -60 * 60_000,
      durationMs: 5 * 60_000,
      distanceM: 1500,
      maxSpeedKmh: 25,
      avgSpeedKmh: 18,
      maxTempMosfet: 38,
      maxTempMotor: 35,
      batteryUsedWh: 12,
      batteryRegenWh: 1,
      startLatitude: 51.1079,
      startLongitude: 17.0385,
    },
  ]

  for (const ride of rides) {
    addHistoryRide(now + ride.startOffsetMs, ride.durationMs, ride, deviceId, deviceName)
  }
}

function addHistoryRide(
  rideStartMs: number,
  durationMs: number,
  ride: RideSeed,
  deviceId: string,
  deviceName: string,
): void {
  const rideEndMs = rideStartMs + durationMs
  const sampleCount = 60
  const gpsPointCount = 6

  const bucket: TelemetryMinuteBucket = {
    id: `e2e-bucket-${rideStartMs}`,
    startAtMs: rideStartMs,
    endAtMs: rideEndMs,
    bucketStartMs: rideStartMs,
    deviceId,
    deviceName,
    sampleCount,
    gpsPointCount,
    preciseGpsPointCount: gpsPointCount,
    maxAbsSpeedKmh: ride.maxSpeedKmh,
    maxGpsSpeedKmh: ride.maxSpeedKmh,
    avgSpeedKmh: ride.avgSpeedKmh,
    avgSpeedSampleCount: sampleCount,
    minBatteryVoltage: 74,
    maxMotorCurrent: 12,
    maxBatteryCurrent: -5,
    maxDuty: 0.25,
    faultCount: 0,
    distanceDeltaM: ride.distanceM,
    gpsDistanceM: ride.distanceM,
    maxTempMosfet: ride.maxTempMosfet,
    maxTempMotor: ride.maxTempMotor,
    batteryUsedWh: ride.batteryUsedWh,
    batteryRegenWh: ride.batteryRegenWh,
    firstLatitude: ride.startLatitude,
    firstLongitude: ride.startLongitude,
    firstMovingAtMs: rideStartMs + 5_000,
    lastMovingAtMs: rideEndMs - 5_000,
    boundaryBefore: 'none',
  }
  telemetryHistory.push(bucket)

  for (let i = 0; i < sampleCount; i++) {
    const t = rideStartMs + i * (durationMs / (sampleCount - 1))
    const progress = i / (sampleCount - 1)
    historySamples.push({
      id: nextHistorySampleId++,
      capturedAtMs: t,
      deviceId,
      deviceName,
      speedKmh: ride.avgSpeedKmh * 0.6 + progress * (ride.maxSpeedKmh - ride.avgSpeedKmh * 0.6),
      batteryVoltage: 75.6 - progress * 1.6,
      batteryPercent: 75 - progress * 2,
      motorCurrent: 5 + Math.sin(progress * Math.PI) * 7,
      batteryCurrent: -2 - Math.sin(progress * Math.PI) * 3,
      dutyCycle: 0.1 + progress * 0.15,
      pitch: 0,
      roll: 0,
      balancePitch: 0,
      balanceCurrent: 0.5,
      erpm: 1000 + progress * 2000,
      state: 0,
      switchState: 0,
      adc1: 1.2,
      adc2: 1.1,
      odometer: 1234 + progress * ride.distanceM,
      tempMosfet: ride.maxTempMosfet - 2 + progress * 2,
      tempMotor: ride.maxTempMotor - 2 + progress * 2,
      hasFault: false,
      faultCode: 0,
      latitude: ride.startLatitude + progress * 0.01,
      longitude: ride.startLongitude + progress * 0.01,
    })
  }

  for (let i = 0; i < gpsPointCount; i++) {
    const progress = i / (gpsPointCount - 1)
    historyGps.push({
      id: nextHistoryGpsId++,
      capturedAtMs: rideStartMs + progress * durationMs,
      deviceId,
      deviceName,
      latitude: ride.startLatitude + progress * 0.01,
      longitude: ride.startLongitude + progress * 0.01,
      speedMps: 5 + progress * 5,
      bearingDeg: 45,
      accuracyM: 3,
      altitudeM: 120,
      timestamp: rideStartMs + progress * durationMs,
      precise: true,
      distanceFromPreviousM: i === 0 ? null : ride.distanceM / (gpsPointCount - 1),
    })
  }

  historyMarkers.push({
    id: nextHistoryMarkerId++,
    occurredAtMs: rideStartMs,
    type: 'connected',
    deviceId,
    deviceName,
    message: null,
    gapMs: null,
  })
  historyMarkers.push({
    id: nextHistoryMarkerId++,
    occurredAtMs: rideEndMs,
    type: 'disconnected',
    deviceId,
    deviceName,
    message: null,
    gapMs: null,
  })
}

export const e2eFake = {
  scan(): void {
    scanActive = true
    clearScanTimer()
    scanTimer = setTimeout(() => {
      scanTimer = null
      if (scanActive) emitDevice(E2E_BOARD_SCAN_RESULT)
    }, 300)
  },

  stopScan(): void {
    scanActive = false
    clearScanTimer()
  },

  selectBoard(boardId: string): void {
    startBoardSession(boardId)
  },

  stopBoard(): void {
    stopBoardSession()
  },

  probeBoardLink(_bleId: string, probeId?: string): BoardProbeResult {
    stopBoardSession()
    for (const listener of boardProbeProgressListeners) {
      listener({ probeId, step: 'completed', elapsedMs: 0 })
    }
    return {
      outcome: 'resolved',
      transport: 'direct',
      candidates: [{ transport: 'direct', hasBms: false }],
    }
  },

  addBoardProbeProgressListener(cb: (event: BoardProbeProgressEvent) => void): EventSubscription {
    boardProbeProgressListeners.add(cb)
    return { remove: () => boardProbeProgressListeners.delete(cb) }
  },

  getLiveState(baseState: LiveStateEvent): LiveStateEvent {
    if (selectedBoardId || connectedBoardId || connectingBoardId) return getLiveState()
    return {
      ...baseState,
      scan: {
        ...baseState.scan,
        phase: scanActive ? 'scanning' : 'idle',
        devices: scanActive ? [E2E_BOARD_SCAN_RESULT] : [],
        error: null,
      },
    }
  },

  setSelectedBoard(boardId: string | null): void {
    selectedBoardId = boardId
    emitLiveState()
  },

  addDeviceListener(cb: (event: DeviceFoundEvent) => void): EventSubscription {
    deviceListeners.add(cb)
    return { remove: () => deviceListeners.delete(cb) }
  },

  addLiveStateListener(cb: (event: LiveStateEvent) => void): EventSubscription {
    liveStateListeners.add(cb)
    return { remove: () => liveStateListeners.delete(cb) }
  },

  addLiveTickListener(cb: (event: TelemetryEvent) => void): EventSubscription {
    liveTickListeners.add(cb)
    return { remove: () => liveTickListeners.delete(cb) }
  },

  addLiveSeriesListener(cb: (event: LiveSeriesEvent) => void): EventSubscription {
    liveSeriesListeners.add(cb)
    return { remove: () => liveSeriesListeners.delete(cb) }
  },

  addTelemetryHistoryListener(cb: (event: TelemetryHistoryEvent) => void): EventSubscription {
    telemetryHistoryListeners.add(cb)
    return { remove: () => telemetryHistoryListeners.delete(cb) }
  },

  getBoards(): Board[] {
    return [...e2eBoards]
  },

  upsertBoard(board: Board): void {
    const index = e2eBoards.findIndex((b) => b.id === board.id)
    if (index >= 0) {
      e2eBoards[index] = board
    } else {
      e2eBoards.push(board)
    }
  },

  getSettings(): AppSettings {
    return { ...e2eSettings }
  },

  updateSetting(key: string, value: unknown): void {
    ;(e2eSettings as unknown as Record<string, unknown>)[key] = value
  },

  getCompanionPresenceBoards(): CompanionPresenceBoard[] {
    return e2eBoards.flatMap((board) =>
      e2eCompanionBoardIds.has(board.id) && board.link
        ? [{ boardId: board.id, name: board.name, bleId: board.link.bleId }]
        : [],
    )
  },

  addCompanionPresenceBoard(boardId: string): void {
    e2eCompanionBoardIds.add(boardId)
    e2eSettings.companionPresenceEnabled = true
  },

  removeCompanionPresenceBoard(boardId: string): void {
    e2eCompanionBoardIds.delete(boardId)
    e2eSettings.companionPresenceEnabled = e2eCompanionBoardIds.size > 0
  },

  setLegalMode(boardId: string, enabled: boolean): void {
    const board = e2eBoards.find((value) => value.id === boardId)
    if (board) board.legalMode = { enabled }
  },

  seedE2EData(flow: string): void {
    if (flow === 'connect-board') {
      const boardId = 'e2e-board-1'
      const board: Board = {
        id: boardId,
        name: 'E2E Board',
        description: 'Seeded by Maestro',
        createdAt: Date.now(),
        batteryConfig: {
          mode: 'preset',
          cellPresetId: 'molicel:21700:p50b',
          seriesCount: 21,
          parallelCount: 2,
        },
        link: { bleId: 'E2:E2:E2:E2:E2:01', transport: 'direct' },
      }
      e2eBoards.length = 0
      e2eBoards.push(board)
      e2eSettings.selectedBoardId = boardId
      e2eSettings.autoConnect = false
    }

    if (flow === 'history') {
      const boardId = 'e2e-board-history'
      const board: Board = {
        id: boardId,
        name: 'E2E History Board',
        description: 'Seeded by Maestro',
        createdAt: Date.now(),
        batteryConfig: {
          mode: 'preset',
          cellPresetId: 'molicel:21700:p50b',
          seriesCount: 21,
          parallelCount: 2,
        },
        link: { bleId: 'E2:E2:E2:E2:E2:02', transport: 'direct' },
      }
      e2eBoards.length = 0
      e2eBoards.push(board)
      e2eSettings.selectedBoardId = boardId
      e2eSettings.autoConnect = false
      seedHistoryData(boardId, board.name)
    }

    if (flow === 'privacy-zones') {
      const boardId = 'e2e-board-privacy'
      const board: Board = {
        id: boardId,
        name: 'E2E Privacy Board',
        description: 'Seeded by Maestro',
        createdAt: Date.now(),
        batteryConfig: {
          mode: 'preset',
          cellPresetId: 'molicel:21700:p50b',
          seriesCount: 21,
          parallelCount: 2,
        },
        link: { bleId: 'E2:E2:E2:E2:E2:03', transport: 'direct' },
      }
      e2eBoards.length = 0
      e2eBoards.push(board)
      e2eSettings.selectedBoardId = boardId
      e2eSettings.autoConnect = false
      const now = Date.now()
      e2ePrivacyZones = [
        {
          id: 'e2e-office',
          preset: 'custom',
          name: 'Office',
          enabled: false,
          centerLatitude: 54.0,
          centerLongitude: 15.0,
          radiusMeters: 500,
          createdAt: now,
          updatedAt: now,
        },
      ]
    }
  },

  getTelemetryHistory,

  getHistoryRange,

  getTelemetrySummary,

  clearTelemetryHistory,

  getPrivacyZones(): PrivacyZone[] {
    return [...e2ePrivacyZones].sort((a, b) => a.createdAt - b.createdAt)
  },

  upsertPrivacyZone(zone: PrivacyZone): void {
    const index = e2ePrivacyZones.findIndex((z) => z.id === zone.id)
    if (index >= 0) {
      e2ePrivacyZones[index] = zone
    } else {
      e2ePrivacyZones.push(zone)
    }
  },

  setPrivacyZoneEnabled(id: string, enabled: boolean): void {
    const index = e2ePrivacyZones.findIndex((z) => z.id === id)
    if (index >= 0) {
      e2ePrivacyZones[index] = { ...e2ePrivacyZones[index], enabled, updatedAt: Date.now() }
    }
  },

  deletePrivacyZone(id: string): void {
    e2ePrivacyZones = e2ePrivacyZones.filter((z) => z.id !== id)
  },
}
