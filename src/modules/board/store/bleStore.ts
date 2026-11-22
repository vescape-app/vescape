import { create } from 'zustand'
import {
  scan as nativeScan,
  stopScan as nativeStopScan,
  setTelemetryRecordingEnabled as nativeSetTelemetryRecordingEnabled,
  selectBoard as nativeSelectBoard,
  stopBoard as nativeStopBoard,
  setDebugRecordingEnabled as nativeSetDebugRecordingEnabled,
  getLiveState as nativeGetLiveState,
  setSelectedBoard as nativeSetSelectedBoard,
  addDeviceListener,
  addErrorListener,
  addLiveTickListener,
  addLiveSeriesListener,
  addFocusedSeriesListener,
  addBmsListener,
  addBmsSeriesListener,
  setBmsSeriesFocused as nativeSetBmsSeriesFocused,
  setFocusedSeriesMetrics as nativeSetFocusedSeriesMetrics,
  setLiveSeriesMetrics as nativeSetLiveSeriesMetrics,
  type BoardPhase,
  type ScanStatus,
  type LiveStateEvent,
  type LinkIntegrity,
  type BmsEvent,
  type BmsSeriesFrame,
  type BmsSeriesUpdate,
} from 'vescape-core'

import { useLiveSeriesStore } from '@/modules/board/store/liveSeriesStore'
import { useFocusedSeriesStore } from '@/modules/board/store/focusedSeriesStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

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
  scanStatus: ScanStatus
  connectionSeq: number
  nativeStateReady: boolean
  devices: ScannedDevice[]
  selectedBoardId: string | null
  connectedId: string | null
  error: string | undefined
  lastTelemetryAt: number | null
  telemetryRecordingEnabled: boolean
  telemetryRecordingPaused: boolean
  recordingFailure: LiveStateEvent['recording']['failure']
  recordDebugSession: boolean
  latestBms: BmsEvent | null
  bmsSeries: BmsSeriesFrame[]
  bmsSeriesWindowMs: number | null
  linkIntegrity: LinkIntegrity
}

interface BleActions {
  startScan: () => void
  stopScan: () => void
  connect: (boardId: string) => Promise<void>
  disconnect: () => Promise<void>
  setRecordDebugSession: (enabled: boolean) => void
  syncNativeState: () => void
  setSelectedBoard: (boardId: string | null) => void
  startTelemetryRecording: () => void
  stopTelemetryRecording: () => void
}

type BleStore = BleState & BleActions
type BleSet = (
  partial: Partial<BleStore> | ((state: BleStore) => Partial<BleStore>),
  replace?: false,
) => void

let liveTickSub: EventSubscription | null = null
let liveSeriesSub: EventSubscription | null = null
let focusedSeriesSub: EventSubscription | null = null
let bmsSub: EventSubscription | null = null
let bmsSeriesSub: EventSubscription | null = null
const focusedSeriesRefs = new Map<string, number>()
const liveSeriesRefs = new Map<string, number>()
let bmsSeriesStreamRefs = 0
let scanSub: EventSubscription | null = null
let scanErrorSub: EventSubscription | null = null

let pendingDevices = new Map<string, ScannedDevice>()
let scanFlushTimer: ReturnType<typeof setTimeout> | null = null
const SCAN_FLUSH_MS = 500

const MAC_ADDRESS_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

function scannedDeviceName(id: string, name?: string): string {
  const candidate = name?.trim()
  if (candidate && !MAC_ADDRESS_RE.test(candidate)) return candidate
  return `Unknown ${id.slice(-5)}`
}

function removeLiveSubscriptions(): void {
  removeBmsSeriesStream(useBleStore.setState as BleSet, true)
  removeFocusedSeriesStream()
  liveTickSub?.remove()
  liveSeriesSub?.remove()
  bmsSub?.remove()
  liveTickSub = null
  liveSeriesSub = null
  bmsSub = null
  useLiveSeriesStore.getState().clear()
}

function removeFocusedSeriesStream(): void {
  focusedSeriesSub?.remove()
  focusedSeriesSub = null
  useFocusedSeriesStore.getState().clear()
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
}

export function applyBoardLiveState(state: LiveStateEvent, source: 'snapshot' | 'event'): void {
  const set = useBleStore.setState
  const isBoardConnected = state.board.phase === 'connected'
  liveTelemetryRuntime.syncConnectionSeq(state.board.connectionSeq)
  if (!isBoardConnected) {
    useLiveSeriesStore.getState().clear()
    useFocusedSeriesStore.getState().clear()
  }
  if (source === 'snapshot') {
    liveTelemetryRuntime.seedFromBoardState(
      isBoardConnected ? state.board : { ...state.board, recentTelemetry: [] },
    )
  } else if (!isBoardConnected) {
    liveTelemetryRuntime.reset()
  }

  set({
    status: state.board.phase,
    scanStatus: state.scan.phase,
    connectionSeq: state.board.connectionSeq,
    nativeStateReady: true,
    selectedBoardId: state.board.selectedBoardId,
    connectedId: state.board.connectedBoardId ?? state.board.bleId,
    error: state.board.error ?? state.scan.error ?? undefined,
    telemetryRecordingEnabled: state.recording.enabled,
    telemetryRecordingPaused: state.recording.paused,
    recordingFailure: state.recording.failure ?? null,
    linkIntegrity: state.board.linkIntegrity,
    lastTelemetryAt: isBoardConnected ? state.board.lastTelemetryAt : null,
  })
}

function resetLivePresentation(set: BleSet): void {
  useLiveSeriesStore.getState().clear()
  useFocusedSeriesStore.getState().clear()
  liveTelemetryRuntime.reset()
  set({
    lastTelemetryAt: null,
    latestBms: null,
    bmsSeries: [],
    bmsSeriesWindowMs: null,
  })
}

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

function removeBmsSeriesStream(set: BleSet, preserveHolds = false): void {
  if (bmsSeriesStreamRefs > 0 || bmsSeriesSub) {
    nativeSetBmsSeriesFocused(false)
  }
  bmsSeriesSub?.remove()
  bmsSeriesSub = null
  if (!preserveHolds) bmsSeriesStreamRefs = 0
  set({ bmsSeries: [], bmsSeriesWindowMs: null })
}

export function startBoardLiveStreams(): () => void {
  const set = useBleStore.setState
  if (!liveTickSub) {
    liveTickSub = addLiveTickListener((tick) => {
      if (!acceptsBoardTelemetry(tick.generation)) return
      liveTelemetryRuntime.ingestTick(tick)
    })
  }
  if (!liveSeriesSub) {
    liveSeriesSub = addLiveSeriesListener((event) => {
      if (!acceptsBoardTelemetry(event.generation)) return
      useLiveSeriesStore.getState().setSeries(event.metrics, event.generation)
    })
  }
  if (!bmsSub) {
    bmsSub = addBmsListener((bms) => {
      set({ latestBms: bms })
    })
  }
  return removeLiveSubscriptions
}

function syncFocusedSeriesMetrics(): void {
  nativeSetFocusedSeriesMetrics([...focusedSeriesRefs.keys()])
}

function ensureFocusedSeriesSub(): void {
  if (focusedSeriesSub) return
  focusedSeriesSub = addFocusedSeriesListener((event) => {
    if (!acceptsBoardTelemetry(event.generation)) return
    if (!focusedSeriesRefs.has(event.metric)) return
    useFocusedSeriesStore.getState().apply(event)
  })
}

function reapplyFocusedSeries(): void {
  if (liveSeriesRefs.size > 0) syncLiveSeriesMetrics()
  if (focusedSeriesRefs.size === 0) return
  ensureFocusedSeriesSub()
  syncFocusedSeriesMetrics()
}

function syncLiveSeriesMetrics(): void {
  nativeSetLiveSeriesMetrics([...liveSeriesRefs.keys()])
}

export function acquireLiveSeries(metrics: readonly string[]): void {
  let added = false
  for (const metric of metrics) {
    const prev = liveSeriesRefs.get(metric) ?? 0
    liveSeriesRefs.set(metric, prev + 1)
    if (prev === 0) added = true
  }
  if (added) syncLiveSeriesMetrics()
}

export function releaseLiveSeries(metrics: readonly string[]): void {
  let removed = false
  for (const metric of metrics) {
    const prev = liveSeriesRefs.get(metric) ?? 0
    if (prev === 0) continue
    if (prev > 1) {
      liveSeriesRefs.set(metric, prev - 1)
    } else {
      liveSeriesRefs.delete(metric)
      removed = true
    }
  }
  if (removed) syncLiveSeriesMetrics()
}

export function acquireFocusedSeries(metric: string): void {
  const prev = focusedSeriesRefs.get(metric) ?? 0
  focusedSeriesRefs.set(metric, prev + 1)
  ensureFocusedSeriesSub()
  if (prev === 0) syncFocusedSeriesMetrics()
}

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
    useFocusedSeriesStore.getState().clear()
  }
}

export function acquireBmsSeriesStream(): void {
  bmsSeriesStreamRefs += 1
  if (bmsSeriesStreamRefs > 1) return
  try {
    applyBoardLiveState(nativeGetLiveState(), 'snapshot')
  } catch {
    // intentional-suppression: No live state yet (not connected) — focus intent still attaches for future samples.
  }
  ensureBmsSeriesStream()
}

function ensureBmsSeriesStream(): void {
  if (!bmsSeriesSub) {
    bmsSeriesSub = addBmsSeriesListener((update) =>
      applyBmsSeriesUpdate(update, useBleStore.setState),
    )
  }
  nativeSetBmsSeriesFocused(true)
}

export function releaseBmsSeriesStream(): void {
  if (bmsSeriesStreamRefs === 0) return
  bmsSeriesStreamRefs -= 1
  if (bmsSeriesStreamRefs > 0) return
  removeBmsSeriesStream(useBleStore.setState as BleSet)
}

export const useBleStore = create<BleState & BleActions>((set, get) => ({
  status: 'idle',
  scanStatus: 'idle',
  connectionSeq: 0,
  nativeStateReady: false,
  devices: [],
  selectedBoardId: null,
  connectedId: null,
  error: undefined,
  lastTelemetryAt: null,
  telemetryRecordingEnabled: false,
  telemetryRecordingPaused: false,
  recordingFailure: null,
  recordDebugSession: false,
  latestBms: null,
  bmsSeries: [],
  bmsSeriesWindowMs: null,
  linkIntegrity: 'unknown',

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
      // intentional-suppression: Native scan may already be stopped after permission or lifecycle changes.
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
      // intentional-suppression: Native may already be stopped.
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
    applyBoardLiveState(nativeGetLiveState(), 'snapshot')
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

bleStoreGlobal.__vescBleStoreCleanup = cleanupBleStoreModule

const hotModule = typeof module === 'undefined' ? null : (module as unknown as HotModule)
hotModule?.hot?.dispose?.(cleanupBleStoreModule)

export function resetBoardLivePresentation(): void {
  resetLivePresentation(useBleStore.setState)
}

export function restoreBoardStreamFocus(): void {
  reapplyFocusedSeries()
  if (bmsSeriesStreamRefs > 0) ensureBmsSeriesStream()
}
