import { AppState } from 'react-native'
import { addAppDataChangedListener, type AppDataChangedEvent } from 'vescape-core'

import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Native owns durable app/board data; JS holds a rendered copy. Whenever native persists a change
 * on its own (e.g. the session-end `lastBattery`, a 30s GPS write), it emits `onAppDataChanged` and
 * JS reloads the matching store — so no app restart is ever needed to see fresh data.
 *
 * To keep a new store in sync: give its native writes a scope in `AppDataRepository` and add one
 * line here. Each store's `load()` is idempotent (diff-and-bail), so a reload that finds no change
 * costs nothing and never re-renders.
 */
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

/**
 * Wire the native->JS data sync. Call once at app root; returns an unsubscribe.
 *
 * Two channels feed the same idempotent reloaders:
 * - **Push:** live `onAppDataChanged` emits while JS is listening.
 * - **Pull:** a foreground catch-up. `onAppDataChanged` is fire-and-forget, so any emit made while
 *   JS was backgrounded (or torn down while the native foreground service kept persisting) is lost
 *   — leaving JS showing e.g. a stale `lastBattery` age after a ride (#174). Re-reading native truth
 *   on `AppState -> active` picks those missed writes up, mirroring how `useBleAppLifecycle`
 *   re-syncs BLE state on foreground.
 */
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
