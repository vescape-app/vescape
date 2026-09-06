import { useEffect } from 'react'

import { useHistoryStore } from '@/modules/history/store/historyStore'

/** How often an open ride list re-reads the recent page, so a ride in progress keeps growing. */
const HISTORY_REFRESH_INTERVAL_MS = 15_000

/** Keeps the ride list current while it is on screen; the ride being recorded grows in place. */
export function useHistoryAutoRefresh(active: boolean) {
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      void useHistoryStore.getState().refreshRecent()
    }, HISTORY_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])
}
