import { AppState } from 'react-native'
import { addAppDataChangedListener, type AppDataChangedEvent } from 'vescape-core'

import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const RELOADERS: Record<AppDataChangedEvent['scope'], () => void> = {
  boards: () => void useBoardStore.getState().load(),
  settings: () => void useSettingsStore.getState().load(),
  alerts: () => {
    // intentional-suppression: Alerts store error is rendered by the active form or list
    void useAlertsStore
      .getState()
      .load(useBoardStore.getState().activeBoardId)
      .catch(() => undefined)
  },
}

function reloadAll(): void {
  for (const reload of Object.values(RELOADERS)) reload()
}

export function startAppDataSync(): () => void {
  const sub = addAppDataChangedListener((event) => RELOADERS[event.scope]?.())
  const appStateSub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') reloadAll()
  })
  return () => {
    sub.remove()
    appStateSub.remove()
  }
}
