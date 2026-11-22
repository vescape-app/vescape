import { useEffect } from 'react'

import { useHistoryStore } from '@/modules/history/store/historyStore'

const HISTORY_REFRESH_INTERVAL_MS = 15_000

export function useHistoryAutoRefresh(active: boolean) {
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      void useHistoryStore.getState().refreshRecent()
    }, HISTORY_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])
}
