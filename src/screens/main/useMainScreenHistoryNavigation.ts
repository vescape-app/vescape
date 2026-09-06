import { useCallback } from 'react'

import { useHistoryStore, type HistorySession } from '@/modules/history/store/historyStore'
import { getNextRideSession, getPreviousRideSession } from '@/screens/main/mainState'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import { openHistoryTarget, type HistoryTarget } from '@/screens/main/history/historyEntry'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

const MAX_HISTORY_PREFETCH_PAGES = 8

interface HistoryNavigationDeps {
  mapRef: React.RefObject<MainMapHandle | null>
  enterHistory: () => void
  enterTelemetry: () => void
  historyFavorites: { resetHistoryFavorites: () => void }
  selectSession: (session: HistorySession | null) => Promise<void>
  removeSelectedSession: () => Promise<void>
  setHistorySheetVisible: (visible: boolean) => void
  setOpenMediaAssetId: (id: string | null) => void
}

/** Entering and leaving History, and stepping between rides — paging older ones in as needed. */
export function useMainScreenHistoryNavigation({
  mapRef,
  enterHistory,
  enterTelemetry,
  historyFavorites,
  selectSession,
  removeSelectedSession,
  setHistorySheetVisible,
  setOpenMediaAssetId,
}: HistoryNavigationDeps) {
  const exitHistory = useCallback(() => {
    setOpenMediaAssetId(null)
    historyFavorites.resetHistoryFavorites()
    void selectSession(null)
    enterTelemetry()
    requestAnimationFrame(() =>
      mapRef.current?.recenterLive({ resetPadding: true, animationDuration: 0 }),
    )
  }, [enterTelemetry, historyFavorites, mapRef, selectSession, setOpenMediaAssetId])

  const openTarget = useCallback(
    (target: HistoryTarget) => {
      return openHistoryTarget(target, {
        enterHistory,
        setHistoryTab: useMainScreenStore.getState().setHistoryTab,
        openFavorite: useMainScreenStore.getState().openFavorite,
        closeFavorite: useMainScreenStore.getState().closeFavorite,
        setHistorySheetVisible,
        setOpenMediaAssetId,
        selectSession,
      })
    },
    [enterHistory, selectSession, setHistorySheetVisible, setOpenMediaAssetId],
  )

  const selectPreviousRide = useCallback(async () => {
    setOpenMediaAssetId(null)
    let previous = getPreviousRideSession(
      useHistoryStore.getState().sessions,
      useHistoryStore.getState().selectedSession,
    )
    let pagesLoaded = 0
    while (
      !previous &&
      useHistoryStore.getState().hasMore &&
      pagesLoaded < MAX_HISTORY_PREFETCH_PAGES
    ) {
      await useHistoryStore.getState().loadMore()
      previous = getPreviousRideSession(
        useHistoryStore.getState().sessions,
        useHistoryStore.getState().selectedSession,
      )
      pagesLoaded += 1
    }
    if (previous) await selectSession(previous)
  }, [selectSession, setOpenMediaAssetId])

  const selectNextRide = useCallback(async () => {
    setOpenMediaAssetId(null)
    const next = getNextRideSession(
      useHistoryStore.getState().sessions,
      useHistoryStore.getState().selectedSession,
    )
    if (next) await selectSession(next)
  }, [selectSession, setOpenMediaAssetId])

  const removeSession = useCallback(() => {
    void removeSelectedSession()
  }, [removeSelectedSession])

  const selectRide = useCallback(
    (session: HistorySession) => {
      void openTarget({ kind: 'ride', session })
    },
    [openTarget],
  )

  const selectFavoriteRide = useCallback(
    (favoriteId: string, session: HistorySession) => {
      void openTarget({ kind: 'favorite', favoriteId, session })
    },
    [openTarget],
  )

  return {
    exitHistory,
    selectPreviousRide,
    selectNextRide,
    removeSession,
    selectRide,
    selectFavoriteRide,
  }
}
