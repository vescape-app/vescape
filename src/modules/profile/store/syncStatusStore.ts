import { AppState } from 'react-native'
import { create } from 'zustand'

import { addSyncStatusListener, getSyncStatus, type SyncStatus } from 'vescape-core'

import { nextBackupBacklog } from '@/modules/profile/lib/backupStatus'

/** What JS shows before the first native status lands: nothing is claimed about backup yet. */
const UNKNOWN: SyncStatus = {
  accountId: null,
  pendingRows: 0,
  activity: 'signedOut',
  pause: null,
  lastUploadAtMs: null,
}

interface SyncStatusState {
  status: SyncStatus
  /** Rows the current drain started with, so a remaining count can be shown as progress. */
  backlog: number
  replace: (status: SyncStatus) => void
}

/**
 * JS mirror of native backup state. Native owns every transition — the uploader decides what
 * `signedOut`, `syncing` or `paused` mean, and this store only projects the answer.
 */
export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  status: UNKNOWN,
  backlog: 0,
  replace: (status) =>
    set((state) => ({ status, backlog: nextBackupBacklog(state.backlog, status) })),
}))

/**
 * Wire the native → JS backup-status mirror. Call once at app root; returns an unsubscribe.
 *
 * Mirrors `startAppStatusSync`:
 * - **Push:** live `onSyncStatus` emits while JS is listening. Native replays the current status on
 *   subscribe, so a fresh listener starts consistent.
 * - **Pull:** a foreground catch-up, because the uploader keeps running (and pausing) while JS is
 *   backgrounded, and those emits are fire-and-forget.
 */
export function startSyncStatusSync(): () => void {
  const project = () => {
    void getSyncStatus().then((status) => useSyncStatusStore.getState().replace(status))
  }
  const sub = addSyncStatusListener((status) => useSyncStatusStore.getState().replace(status))
  project()
  const appStateSub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') project()
  })
  return () => {
    sub.remove()
    appStateSub.remove()
  }
}
