import { AppState } from 'react-native'
import {
  addMaintenanceStateListener,
  getMaintenanceState,
  type MaintenanceState,
} from 'vescape-core'

import { useFavoriteStore } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { useMaintenanceStore } from '@/modules/settings/store/maintenanceStore'

/**
 * Mirror the native Maintenance Job runner into JS, and re-read open history whenever native says
 * committed chunks changed it (`historyRevision`, already throttled natively). Call once at app
 * root; returns an unsubscribe.
 */
export function startMaintenanceSync(): () => void {
  let revision: number | null = null
  const apply = (state: MaintenanceState) => {
    useMaintenanceStore.getState().setState(state)
    if (revision !== null && state.historyRevision !== revision) {
      void useHistoryStore.getState().reloadLoadedSessions()
      void useFavoriteStore.getState().load()
    }
    revision = state.historyRevision
  }
  apply(getMaintenanceState())
  const sub = addMaintenanceStateListener(apply)
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') apply(getMaintenanceState())
  })
  return () => {
    sub.remove()
    appStateSub.remove()
  }
}
