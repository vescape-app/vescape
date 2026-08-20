import { create } from 'zustand'
import {
  scan as nativeScan,
  stopScan as nativeStopScan,
  startLocationUpdates as nativeStartLocationUpdates,
  setTelemetryRecordingEnabled as nativeSetTelemetryRecordingEnabled,
  selectBoard as nativeSelectBoard,
  stopBoard as nativeStopBoard,
  setDebugRecordingEnabled as nativeSetDebugRecordingEnabled,
  getLiveState as nativeGetLiveState,
  setSelectedBoard as nativeSetSelectedBoard,
  addDeviceListener,
  addErrorListener,
  addLiveStateListener,
  addLiveTickListener,
  addLiveSeriesListener,
  addFocusedSeriesListener,
  addBmsListener,
  addBmsSeriesListener,
  addLocationListener,
  getRemoteTiltState as nativeGetRemoteTiltState,
  setBmsSeriesFocused as nativeSetBmsSeriesFocused,
  setFocusedSeriesMetrics as nativeSetFocusedSeriesMetrics,
  type BoardPhase,
  type GpsPhase,
  type ScanStatus,
  type LocationEvent,
  type LiveStateEvent,
  type ConnectionPauseState,
  type PresenceScanState,
  type LinkIntegrity,
  type BmsEvent,
  type BmsSeriesFrame,
  type BmsSeriesUpdate,
  type RemoteTiltState,
} from 'vescape-core'

import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useLiveSeriesStore } from '@/modules/board/store/liveSeriesStore'
import { useFocusedSeriesStore } from '@/modules/board/store/focusedSeriesStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { IDLE_PRESENCE_SCAN } from '@/modules/board/lib/presenceScan'
import type { LiveStatusSummary } from '@/modules/board/lib/liveMetricHistory'

interface EventSubscription {
  remove(): void
}

export interface ScannedDevice {
  id: string
  name: string
  rssi: number
  serviceUUIDs: string[]
}

export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'

type BleStatus = BoardPhase

interface BleState {
  status: BleStatus
  gpsStatus: GpsPhase
  scanStatus: ScanStatus
  /**
   * Native-owned Board Presence Scan (ADR 0035). Rendered only — JS never starts or times it.
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPresenceScan.kt `PresenceScanState`
   * @parity /modules/vescape-core/ios/connection/BoardPresenceScan.swift `PresenceScanState`
   */
  presence: PresenceScanState
  /**
   * Board-scoped Automatic Connection Pause for the selected Board (ADR 0035), or `null`.
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionPause.kt `ConnectionPause`
   * @parity /modules/vescape-core/ios/connection/ConnectionPause.swift `ConnectionPause`
   */
  connectionPause: ConnectionPauseState | null
  connectionSeq: number
  nativeStateReady: boolean
  devices: ScannedDevice[]
  selectedBoardId: string | null
  connectedId: string | null
  error: string | undefined
  liveLocationHistory: LocationEvent[]
  latestApproximateLocation: LocationEvent | null
  liveStatus: LiveStatusSummary
  metricVersion: number
  telemetryRecordingEnabled: boolean
  telemetryRecordingPaused: boolean
  recordDebugSession: boolean
  latestBms: BmsEvent | null
  bmsSeries: BmsSeriesFrame[]
  bmsSeriesWindowMs: number | null
  linkIntegrity: LinkIntegrity
  /** Active remote-tilt command mirrored from native telemetry, or null when idle. */
  remoteTilt: RemoteTiltState | null
}

interface BleActions {
  startScan: () => void
  stopScan: () => void
  connect: (boardId: string) => Promise<void>
  disconnect: () => Promise<void>
  setRecordDebugSession: (enabled: boolean) => void
  syncNativeState: () => void
  syncRemoteTilt: () => void
  setSelectedBoard: (boardId: string | null) => void
  startTelemetryRecording: () => void
  stopTelemetryRecording: () => void
  startGpsTracking: () => void
}

type BleStore = BleState & BleActions
type BleSet = (
  partial: Partial<BleStore> | ((state: BleStore) => Partial<BleStore>),
  replace?: false,
) => void

let liveSub: EventSubscription | null = null
let liveTickSub: EventSubscription | null = null
let liveSeriesSub: EventSubscription | null = null
let focusedSeriesSub: EventSubscription | null = null
let bmsSub: EventSubscription | null = null
let bmsSeriesSub: EventSubscription | null = null
let locationSub: EventSubscription | null = null
// The high-res focused stream only runs while a `/control` detail chart is mounted.
// Ref-counted per metric so native emits `onFocusedSeries` only for focused metrics.
const focusedSeriesRefs = new Map<string, number>()
let bmsSeriesStreamRefs = 0
let scanSub: EventSubscription | null = null
let scanErrorSub: EventSubscription | null = null
let settingsUnsubscribe: (() => void) | null = null

let pendingDevices = new Map<string, ScannedDevice>()
let scanFlushTimer: ReturnType<typeof setTimeout> | null = null
const SCAN_FLUSH_MS = 500

// Cold-path publish throttle. The 31Hz tick → SharedValues path stays unthrottled (no render);
// this only caps how often the store snapshot bumps, which re-renders the SVG sparklines, live
// charts and map trail. GPS fixes drive it, so an unthrottled publish saturates the JS thread.
let liveHistoryPublishTimer: ReturnType<typeof setTimeout> | null = null
const LIVE_HISTORY_PUBLISH_MS = 1000

const MAC_ADDRESS_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

function scannedDeviceName(id: string, name?: string): string {
  const candidate = name?.trim()
  if (candidate && !MAC_ADDRESS_RE.test(candidate)) return candidate
  return `Unknown ${id.slice(-5)}`
}

const EMPTY_LIVE_STATUS: LiveStatusSummary = {
  boardSampleCount: 0,
  boardLastPacketAt: null,
  boardAvgLatencyMs: null,
  gpsSampleCount: 0,
  gpsLastFixAt: null,
  gpsPrecise: false,
  gpsAccuracyM: null,
}

function removeLiveSubscriptions(): void {
  removeBmsSeriesStream(useBleStore.setState as BleSet)
  removeFocusedSeriesStream()
  liveSub?.remove()
  liveTickSub?.remove()
  liveSeriesSub?.remove()
  bmsSub?.remove()
  locationSub?.remove()
  liveSub = null
  liveTickSub = null
  liveSeriesSub = null
  bmsSub = null
  locationSub = null
  useLiveSeriesStore.getState().clear()
  clearLiveHistoryPublishTimer()
}

/** Detach the focused-series bridge sub and clear its JS window; keeps the per-metric ref counts. */
function removeFocusedSeriesStream(): void {
  focusedSeriesSub?.remove()
  focusedSeriesSub = null
  useFocusedSeriesStore.getState().clear()
}

function clearLiveHistoryPublishTimer(): void {
  if (!liveHistoryPublishTimer) return
  clearTimeout(liveHistoryPublishTimer)
  liveHistoryPublishTimer = null
}

function clearScanFlushTimer(): void {
  if (!scanFlushTimer) return
  clearTimeout(scanFlushTimer)
  scanFlushTimer = null
}

function flushPendingDevices(set: BleSet): void {
  clearScanFlushTimer()
  if (pendingDevices.size === 0) return
  const batch = pendingDevices
  pendingDevices = new Map()
  set((state) => {
    const updated = [...state.devices]
    for (const device of batch.values()) {
      const idx = updated.findIndex((d) => d.id === device.id)
      if (idx !== -1) {
        updated[idx] = device
      } else {
        updated.push(device)
      }
    }
    return { devices: updated }
  })
}

function scheduleScanFlush(set: BleSet): void {
  if (scanFlushTimer) return
  scanFlushTimer = setTimeout(() => {
    scanFlushTimer = null
    flushPendingDevices(set)
  }, SCAN_FLUSH_MS)
}

function removeScanSubscriptions(): void {
  clearScanFlushTimer()
  pendingDevices = new Map()
  scanSub?.remove()
  scanErrorSub?.remove()
  scanSub = null
  scanErrorSub = null
}

function cleanupBleStoreModule(): void {
  removeLiveSubscriptions()
  removeScanSubscriptions()
  settingsUnsubscribe?.()
  settingsUnsubscribe = null
}

function applyLiveState(state: LiveStateEvent, set: BleSet): void {
  const isBoardConnected = state.board.phase === 'connected'
  const hasRecentTelemetry = isBoardConnected && state.board.recentTelemetry.length > 0
  const hasRecentLocations = state.gps.recentLocations.length > 0
  const shouldSeedLiveState = hasRecentTelemetry || hasRecentLocations
  let live

  // Every live state carries the authoritative generation, and `ingestTick` drops any tick that
  // disagrees with it. Syncing only on the seeding paths left a hole: a session that connects
  // before the UI mounts and has no telemetry or GPS to seed from yet (a replay, or a board that
  // connects faster than its first frame) leaves the runtime on the previous generation, so every
  // later tick is discarded and the gauges read "—" while the store-fed sparklines keep updating.
  liveTelemetryRuntime.syncConnectionSeq(state.board.connectionSeq)

  if (isBoardConnected) {
    live = shouldSeedLiveState
      ? liveTelemetryRuntime.seedFromLiveState(state)
      : liveTelemetryRuntime.getSnapshot()
  } else {
    useLiveSeriesStore.getState().clear()
    useFocusedSeriesStore.getState().clear()
    live = liveTelemetryRuntime.clearBoardTelemetry()
  }

  set({
    status: state.board.phase,
    gpsStatus: state.gps.phase,
    scanStatus: state.scan.phase,
    presence: state.presence ?? IDLE_PRESENCE_SCAN,
    connectionPause: state.pause ?? null,
    connectionSeq: state.board.connectionSeq,
    nativeStateReady: true,
    selectedBoardId: state.board.selectedBoardId,
    connectedId: state.board.connectedBoardId ?? state.board.bleId,
    error: state.board.error ?? state.gps.error ?? state.scan.error ?? undefined,
    telemetryRecordingEnabled: state.recording.enabled,
    telemetryRecordingPaused: state.recording.paused,
    remoteTilt: state.board.remoteTilt,
    linkIntegrity: state.board.linkIntegrity,
    ...(shouldSeedLiveState || !isBoardConnected
      ? {
          liveLocationHistory: live.liveLocationHistory,
          latestApproximateLocation: live.latestApproximateLocation,
          liveStatus: live.liveStatus,
          metricVersion: liveTelemetryRuntime.getVersion(),
        }
      : {}),
  })
}

function sameRemoteTilt(a: RemoteTiltState | null, b: RemoteTiltState | null): boolean {
  return (
    a?.value === b?.value &&
    a?.phase === b?.phase &&
    a?.decay?.elapsedMs === b?.decay?.elapsedMs &&
    a?.decay?.totalMs === b?.decay?.totalMs
  )
}

function resetLivePresentation(set: BleSet): void {
  clearLiveHistoryPublishTimer()
  useLiveSeriesStore.getState().clear()
  useFocusedSeriesStore.getState().clear()
  const live = liveTelemetryRuntime.reset()
  set({
    liveLocationHistory: live.liveLocationHistory,
    latestApproximateLocation: live.latestApproximateLocation,
    liveStatus: live.liveStatus,
    metricVersion: liveTelemetryRuntime.getVersion(),
    latestBms: null,
    bmsSeries: [],
    bmsSeriesWindowMs: null,
  })
}

// Coalesces store snapshot bumps onto a fixed cadence. The 31Hz tick path never calls this —
// it only touches SharedValues. This drives the cold render path (sparklines/charts/map trail).
function scheduleLiveSnapshot(set: BleSet): void {
  if (liveHistoryPublishTimer) return
  liveHistoryPublishTimer = setTimeout(() => {
    liveHistoryPublishTimer = null
    publishLiveSnapshot(set)
  }, LIVE_HISTORY_PUBLISH_MS)
}

function publishLiveSnapshot(set: BleSet): void {
  const live = liveTelemetryRuntime.consumePendingSnapshot()
  if (!live) return
  set({
    liveLocationHistory: live.liveLocationHistory,
    latestApproximateLocation: live.latestApproximateLocation,
    liveStatus: live.liveStatus,
    metricVersion: liveTelemetryRuntime.getVersion(),
  })
}

/** Board telemetry is only displayable while native reports a live Board connection. */
function acceptsBoardTelemetry(generation: number | null | undefined): boolean {
  const state = useBleStore.getState()
  return state.status === 'connected' && (generation == null || generation === state.connectionSeq)
}

function pruneBmsSeries(frames: BmsSeriesFrame[], windowMs: number): BmsSeriesFrame[] {
  const newest = frames.at(-1)?.capturedAt
  if (newest == null) return []
  const oldest = newest - windowMs
  return frames.filter((frame) => frame.capturedAt >= oldest)
}

function mergeBmsSeriesFrames(
  current: BmsSeriesFrame[],
  incoming: BmsSeriesFrame[],
): BmsSeriesFrame[] {
  if (incoming.length === 0) return current
  const incomingTimes = new Set(incoming.map((frame) => frame.capturedAt))
  return [...current.filter((frame) => !incomingTimes.has(frame.capturedAt)), ...incoming].sort(
    (a, b) => a.capturedAt - b.capturedAt,
  )
}

function applyBmsSeriesUpdate(update: BmsSeriesUpdate, set: BleSet): void {
  if (!acceptsBoardTelemetry(update.generation)) return
  set((state) => {
    const frames =
      update.mode === 'snapshot'
        ? update.frames
        : mergeBmsSeriesFrames(state.bmsSeries, update.frames)
    return {
      bmsSeries: pruneBmsSeries(frames, update.windowMs),
      bmsSeriesWindowMs: update.windowMs,
    }
  })
}

function removeBmsSeriesStream(set: BleSet): void {
  if (bmsSeriesStreamRefs > 0 || bmsSeriesSub) {
    nativeSetBmsSeriesFocused(false)
  }
  bmsSeriesSub?.remove()
  bmsSeriesSub = null
  bmsSeriesStreamRefs = 0
  set({ bmsSeries: [], bmsSeriesWindowMs: null })
}

function installLiveSubscriptions(set: BleSet): void {
  if (!liveSub) {
    liveSub = addLiveStateListener((state) => applyLiveState(state, set))
  }
  if (!liveTickSub) {
    // Hot path: scalar tick drives SharedValues. Remote tilt is the one deliberate
    // store mirror here: the mounted pad needs each authoritative native command value.
    liveTickSub = addLiveTickListener((tick) => {
      if (!acceptsBoardTelemetry(tick.generation)) return
      liveTelemetryRuntime.ingestTick(tick)
      if (tick.remoteTilt !== undefined) {
        const remoteTilt = tick.remoteTilt ?? null
        set((state) => (sameRemoteTilt(state.remoteTilt, remoteTilt) ? {} : { remoteTilt }))
      }
    })
  }
  if (!liveSeriesSub) {
    // Cold path: natively-decimated min/max sparkline series (~1Hz). Tiny payload, no raw
    // samples. Drives every center-screen sparkline with zero JS-thread projection.
    liveSeriesSub = addLiveSeriesListener((event) => {
      if (!acceptsBoardTelemetry(event.generation)) return
      useLiveSeriesStore.getState().setSeries(event.metrics, event.generation)
    })
  }
  // The high-res `onFocusedSeries` stream attaches on demand via acquireFocusedSeries,
  // only while a `/control` detail chart is mounted.
  if (!bmsSub) {
    bmsSub = addBmsListener((bms) => {
      set({ latestBms: bms })
    })
  }
  if (!locationSub) {
    locationSub = addLocationListener((location) => {
      liveTelemetryRuntime.ingestLocation(location)
      scheduleLiveSnapshot(set)
    })
  }
}

/** Push the current focused-metric set to native (the union of everything held). */
function syncFocusedSeriesMetrics(): void {
  nativeSetFocusedSeriesMetrics([...focusedSeriesRefs.keys()])
}

/** Attach the `onFocusedSeries` bridge sub once; idempotent. */
function ensureFocusedSeriesSub(): void {
  if (focusedSeriesSub) return
  focusedSeriesSub = addFocusedSeriesListener((event) => {
    if (!acceptsBoardTelemetry(event.generation)) return
    // Drop a late event for a metric already released — it must not restore stale series.
    if (!focusedSeriesRefs.has(event.metric)) return
    useFocusedSeriesStore.getState().apply(event)
  })
}

/** Re-arm focus after a (re)connect: subscriptions were torn down but the ref counts survive. */
function reapplyFocusedSeries(): void {
  if (focusedSeriesRefs.size === 0) return
  ensureFocusedSeriesSub()
  syncFocusedSeriesMetrics()
}

/**
 * Focuses one metric's high-res stream for a mounted `/control` detail chart. Ref-counted per
 * metric: the first hold on any metric attaches the `onFocusedSeries` bridge sub; each new metric
 * re-pushes the focus set so native starts emitting it (and an immediate snapshot).
 */
export function acquireFocusedSeries(metric: string): void {
  const prev = focusedSeriesRefs.get(metric) ?? 0
  focusedSeriesRefs.set(metric, prev + 1)
  ensureFocusedSeriesSub()
  if (prev === 0) syncFocusedSeriesMetrics()
}

/** Releases a detail chart's hold on a metric; the last hold overall detaches the bridge sub. */
export function releaseFocusedSeries(metric: string): void {
  const prev = focusedSeriesRefs.get(metric) ?? 0
  if (prev === 0) return
  if (prev > 1) {
    focusedSeriesRefs.set(metric, prev - 1)
    return
  }
  focusedSeriesRefs.delete(metric)
  useFocusedSeriesStore.getState().clearMetric(metric)
  syncFocusedSeriesMetrics()
  if (focusedSeriesRefs.size === 0) {
    focusedSeriesSub?.remove()
    focusedSeriesSub = null
    // No listener left to refresh exclusions/generation — drop them so a later
    // focus doesn't briefly render bands from the previous session.
    useFocusedSeriesStore.getState().clear()
  }
}

/** Opens the focused Live BMS Series bridge stream for the battery detail view. */
export function acquireBmsSeriesStream(): void {
  bmsSeriesStreamRefs += 1
  if (bmsSeriesStreamRefs > 1) return
  const set = useBleStore.setState as BleSet
  try {
    applyLiveState(nativeGetLiveState(), set)
  } catch {
    // No live state yet (not connected) — focus intent still attaches for future samples.
  }
  if (!bmsSeriesSub) {
    bmsSeriesSub = addBmsSeriesListener((update) => applyBmsSeriesUpdate(update, set))
  }
  nativeSetBmsSeriesFocused(true)
}

/** Closes the focused Live BMS Series bridge stream and clears its JS window. */
export function releaseBmsSeriesStream(): void {
  if (bmsSeriesStreamRefs === 0) return
  bmsSeriesStreamRefs -= 1
  if (bmsSeriesStreamRefs > 0) return
  removeBmsSeriesStream(useBleStore.setState as BleSet)
}

export const useBleStore = create<BleState & BleActions>((set, get) => ({
  status: 'idle',
  gpsStatus: 'idle',
  scanStatus: 'idle',
  presence: IDLE_PRESENCE_SCAN,
  connectionPause: null,
  connectionSeq: 0,
  nativeStateReady: false,
  devices: [],
  selectedBoardId: null,
  connectedId: null,
  error: undefined,
  liveLocationHistory: [],
  latestApproximateLocation: null,
  liveStatus: EMPTY_LIVE_STATUS,
  metricVersion: 0,
  telemetryRecordingEnabled: false,
  telemetryRecordingPaused: false,
  recordDebugSession: false,
  latestBms: null,
  bmsSeries: [],
  bmsSeriesWindowMs: null,
  linkIntegrity: 'unknown',
  remoteTilt: null,

  startScan() {
    const currentStatus = get().status
    if (
      currentStatus === 'connecting' ||
      currentStatus === 'discovering' ||
      currentStatus === 'subscribing' ||
      currentStatus === 'waiting_for_telemetry' ||
      currentStatus === 'connected' ||
      currentStatus === 'stale' ||
      currentStatus === 'reconnecting' ||
      currentStatus === 'rescanning' ||
      currentStatus === 'disconnecting'
    ) {
      return
    }

    set({ devices: [], error: undefined })

    removeScanSubscriptions()
    scanErrorSub = addErrorListener((event) => {
      set({ scanStatus: 'error', error: event.message })
    })
    scanSub = addDeviceListener((device) => {
      const name = scannedDeviceName(device.id, device.name)
      const rssi = device.rssi ?? -99
      const serviceUUIDs = device.serviceUUIDs ?? []
      const prev = pendingDevices.get(device.id)
      pendingDevices.set(device.id, {
        id: device.id,
        name,
        rssi,
        serviceUUIDs: serviceUUIDs.length > 0 ? serviceUUIDs : (prev?.serviceUUIDs ?? []),
      })
      scheduleScanFlush(set)
    })

    try {
      nativeScan()
      get().syncNativeState()
    } catch (err) {
      removeScanSubscriptions()
      set({
        scanStatus: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  stopScan() {
    try {
      nativeStopScan()
      get().syncNativeState()
    } catch {
      // Native scan may already be stopped after permission or lifecycle changes.
    }
    removeScanSubscriptions()
  },

  async connect(boardId: string) {
    get().stopScan()
    resetLivePresentation(set)
    nativeSetSelectedBoard(boardId)
    try {
      await nativeSelectBoard(boardId)
      if (bmsSeriesStreamRefs > 0) {
        nativeSetBmsSeriesFocused(true)
      }
      reapplyFocusedSeries()
    } catch {
      get().syncNativeState()
    }
  },

  async disconnect() {
    try {
      await nativeStopBoard()
    } catch {
      // Native may already be stopped.
    } finally {
      resetLivePresentation(set)
      get().syncNativeState()
    }
  },

  setRecordDebugSession(enabled: boolean) {
    set({ recordDebugSession: enabled })
    nativeSetDebugRecordingEnabled(enabled)
  },

  syncNativeState() {
    installLiveSubscriptions(set)
    const state = nativeGetLiveState()
    applyLiveState(state, set)
  },

  syncRemoteTilt() {
    installLiveSubscriptions(set)
    const remoteTilt = nativeGetRemoteTiltState()
    set((state) => (sameRemoteTilt(state.remoteTilt, remoteTilt) ? {} : { remoteTilt }))
  },

  setSelectedBoard(boardId: string | null) {
    nativeSetSelectedBoard(boardId)
    get().syncNativeState()
  },

  startTelemetryRecording() {
    nativeSetTelemetryRecordingEnabled(true)
    get().syncNativeState()
  },

  stopTelemetryRecording() {
    nativeSetTelemetryRecordingEnabled(false)
    get().syncNativeState()
  },

  startGpsTracking() {
    nativeStartLocationUpdates()
    get().syncNativeState()
  },
}))

interface HotModule {
  hot?: {
    dispose?: (callback: () => void) => void
  }
}

type BleStoreGlobal = typeof globalThis & {
  __vescBleStoreCleanup?: () => void
}

const bleStoreGlobal = globalThis as BleStoreGlobal
bleStoreGlobal.__vescBleStoreCleanup?.()

settingsUnsubscribe = useSettingsStore.subscribe((settings, previousSettings) => {
  if (settings.liveHistoryLimit === previousSettings.liveHistoryLimit) return
  const state = nativeGetLiveState()
  applyLiveState(state, useBleStore.setState)
})

bleStoreGlobal.__vescBleStoreCleanup = cleanupBleStoreModule

const hotModule = typeof module === 'undefined' ? null : (module as unknown as HotModule)
hotModule?.hot?.dispose?.(cleanupBleStoreModule)
