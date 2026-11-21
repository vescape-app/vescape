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

export function syncLiveState(): void {
  applyLiveState(getLiveState(), 'snapshot')
}

export function refreshGpsDemand(): void {
  refreshLocationDemand()
  syncLiveState()
}

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

const syncGlobal = globalThis as typeof globalThis & { __vescLiveStateSyncCleanup?: () => void }
syncGlobal.__vescLiveStateSyncCleanup?.()
syncGlobal.__vescLiveStateSyncCleanup = () => stopSync?.()
