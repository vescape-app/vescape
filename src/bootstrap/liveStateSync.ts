import { AppState } from 'react-native'
import {
  addLiveStateListener,
  addLocationListener,
  getLiveState,
  isReplayBoardId,
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
let replayBoardId: string | null = null

function applyLiveState(state: LiveStateEvent, source: 'snapshot' | 'event'): void {
  const nextReplayId = isReplayBoardId(state.board.connectedBoardId)
    ? state.board.connectedBoardId
    : null
  if (nextReplayId !== replayBoardId) {
    resetBoardLivePresentation()
    useLocationStore.getState().reset()
  }
  replayBoardId = nextReplayId
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
  const stateSub = addLiveStateListener((state) => applyLiveState(state, 'event'))
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
