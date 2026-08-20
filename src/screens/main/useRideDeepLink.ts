import { useEffect } from 'react'

import { findSessionById } from '@/modules/history/lib/sessions'
import { useHistoryStore, type HistorySession } from '@/modules/history/store/historyStore'
import { useRideDeepLinkStore } from '@/modules/history/store/rideDeepLinkStore'

const MAX_HISTORY_PREFETCH_PAGES = 8

/**
 * Opens the exact ride a ride-summary notification tap named (#410). Ride History pages in
 * newest-first, so an older ride is paged in until it appears (or the pages run out, e.g. after the
 * rider deleted it — then the deep link simply lands on History).
 */
export function useRideDeepLink({
  enterHistoryMode,
  selectRide,
}: {
  enterHistoryMode: () => Promise<void>
  selectRide: (session: HistorySession) => void
}) {
  const pendingRideId = useRideDeepLinkStore((s) => s.pendingRideId)

  useEffect(() => {
    if (!pendingRideId) return
    let cancelled = false

    void (async () => {
      await enterHistoryMode()
      let session = findSessionById(useHistoryStore.getState().sessions, pendingRideId)
      let pagesLoaded = 0
      while (
        !session &&
        useHistoryStore.getState().hasMore &&
        pagesLoaded < MAX_HISTORY_PREFETCH_PAGES
      ) {
        await useHistoryStore.getState().loadMore()
        pagesLoaded += 1
        session = findSessionById(useHistoryStore.getState().sessions, pendingRideId)
      }
      if (cancelled) return
      if (session) selectRide(session)
      useRideDeepLinkStore.getState().clearPendingRide()
    })()

    return () => {
      cancelled = true
    }
  }, [enterHistoryMode, pendingRideId, selectRide])
}
