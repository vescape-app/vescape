import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

export function startAlertsBoardSync(): () => void {
  let current = useBoardStore.getState().activeBoardId
  // intentional-suppression: Alerts store error is rendered by the active form or list
  void useAlertsStore
    .getState()
    .load(current)
    .catch(() => undefined)
  return useBoardStore.subscribe((state) => {
    if (state.activeBoardId !== current) {
      current = state.activeBoardId
      // intentional-suppression: Alerts store error is rendered by the active form or list
      void useAlertsStore
        .getState()
        .load(current)
        .catch(() => undefined)
    }
  })
}
