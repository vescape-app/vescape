import { AppState } from 'react-native'
import {
  addLiveStateListener,
  addLocationListener,
  getLiveState,
  refreshLocationDemand,
  type LiveStateEvent,
} from 'vescape-core'

import {
  applyBoardLiveState,
  resetBoardLivePresentation,
  restoreBoardStreamFocus,
  startBoardLiveStreams,
  useBleStore,
} from '@/modules/board/store/bleStore'
import { useLocationStore } from '@/modules/location/store/locationStore'
import { getLiveWindowMs, useSettingsStore } from '@/modules/settings/store/settingsStore'

let stopSync: (() => void) | null = null
let seenConnectionSeq: number | null = null
let seenConnected = false

/**
 * Status events omit history, so a new Board Session, or a link that has just come up, pulls a full
 * snapshot instead: native may have started that session with history already in place (Replay
 * Warmup) or a trail of its own (a replay's recorded fixes), and both replace what JS holds.
 */
function onLiveStateEvent(state: LiveStateEvent): void {
  const connected = state.board.phase === 'connected'
  const newSession = state.board.connectionSeq !== seenConnectionSeq
  if (newSession || (connected && !seenConnected)) {
    if (newSession) resetBoardLivePresentation()
    syncLiveState()
    return
  }
  applyLiveState(state, 'event')
}

function applyLiveState(state: LiveStateEvent, source: 'snapshot' | 'event'): void {
  seenConnectionSeq = state.board.connectionSeq
  seenConnected = state.board.phase === 'connected'
  applyBoardLiveState(state, source)
  const location = useLocationStore.getState()
  if (source === 'snapshot') location.applySnapshot(state.gps, getLiveWindowMs())
  else location.applyStatus(state.gps, getLiveWindowMs())
}

/** Authoritative catch-up after startup, foreground entry, or a retention-setting change. */
export function syncLiveState(): void {
  applyLiveState(getLiveState(), 'snapshot')
}

/** Permission changes are intents; native still chooses GPS power and collection lifecycle. */
export function refreshGpsDemand(): void {
  refreshLocationDemand()
  syncLiveState()
}

/** One app-wide subscription owner. Board actions never stop the phone-location stream. */
export function startLiveStateSync(): () => void {
  stopSync?.()
  const stopBoard = startBoardLiveStreams()
  const stateSub = addLiveStateListener(onLiveStateEvent)
  const locationSub = addLocationListener((location) => {
    useLocationStore.getState().ingestLocation(location, getLiveWindowMs())
  })
  const lifecycleSub = AppState.addEventListener('change', (status) => {
    if (status === 'active') syncLiveState()
    if (status === 'background' && useBleStore.getState().scanStatus === 'scanning') {
      useBleStore.getState().stopScan()
    }
  })
  const unsubscribeSettings = useSettingsStore.subscribe((settings, previous) => {
    if (settings.liveHistoryLimit !== previous.liveHistoryLimit) syncLiveState()
  })
  let stopped = false
  const cleanup = () => {
    if (stopped) return
    stopped = true
    stopBoard()
    stateSub.remove()
    locationSub.remove()
    lifecycleSub.remove()
    unsubscribeSettings()
    useLocationStore.getState().cancelPending()
    if (stopSync === cleanup) stopSync = null
  }
  stopSync = cleanup
  syncLiveState()
  restoreBoardStreamFocus()
  return cleanup
}

// Fast Refresh must not leave the previous module's native listeners or publication timer alive.
const syncGlobal = globalThis as typeof globalThis & { __vescLiveStateSyncCleanup?: () => void }
syncGlobal.__vescLiveStateSyncCleanup?.()
syncGlobal.__vescLiveStateSyncCleanup = () => stopSync?.()
