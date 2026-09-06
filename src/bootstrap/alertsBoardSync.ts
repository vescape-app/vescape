import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

/**
 * Alert Rules are owned by one Board and the native engine evaluates only the connected Board's
 * rules (#254). JS mirrors that: the alerts store always holds the active Board's rules. This wires
 * the store to follow `activeBoardId` — on first run and on every change (board switch, first load,
 * add-board) — so switching boards switches the effective rule set in the UI too.
 *
 * Call once at app root; returns an unsubscribe.
 */
export function startAlertsBoardSync(): () => void {
  let current = useBoardStore.getState().activeBoardId
  void useAlertsStore
    .getState()
    .load(current)
    .catch(() => {})
  return useBoardStore.subscribe((state) => {
    if (state.activeBoardId !== current) {
      current = state.activeBoardId
      void useAlertsStore
        .getState()
        .load(current)
        .catch(() => {})
    }
  })
}
