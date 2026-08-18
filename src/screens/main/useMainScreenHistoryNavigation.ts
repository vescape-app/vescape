import { useCallback } from 'react'

import { useHistoryStore, type HistorySession } from '@/modules/history/store/historyStore'
import {
  getLatestSession,
  getNextRideSession,
  getPreviousRideSession,
} from '@/screens/main/mainState'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

const TARGET_INITIAL_HISTORY_SESSIONS = 12
const MAX_HISTORY_PREFETCH_PAGES = 8

interface HistoryNavigationDeps {
  mapRef: React.RefObject<MainMapHandle | null>
  enterHistory: () => void
  enterTelemetry: () => void
  historyFavorites: { loadFavorites: () => Promise<void>; resetHistoryFavorites: () => void }
  loadInitial: () => Promise<void>
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
  loadInitial,
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

  const loadOlderHistoryPages = useCallback(
    async (targetSessionCount = TARGET_INITIAL_HISTORY_SESSIONS) => {
      let pagesLoaded = 0
      while (
        useHistoryStore.getState().hasMore &&
        useHistoryStore.getState().sessions.length < targetSessionCount &&
        pagesLoaded < MAX_HISTORY_PREFETCH_PAGES
      ) {
        await useHistoryStore.getState().loadMore()
        pagesLoaded += 1
      }
    },
    [],
  )

  const enterHistoryMode = useCallback(async () => {
    enterHistory()
    void historyFavorites.loadFavorites()
    await loadInitial()
    await loadOlderHistoryPages()
    if (useMainScreenStore.getState().mode !== 'history') return
    const latest = getLatestSession(useHistoryStore.getState().sessions)
    if (latest) {
      await selectSession(latest)
    }
  }, [enterHistory, historyFavorites, loadInitial, loadOlderHistoryPages, selectSession])

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
      setOpenMediaAssetId(null)
      setHistorySheetVisible(false)
      void selectSession(session)
      enterHistory()
    },
    [enterHistory, selectSession, setHistorySheetVisible, setOpenMediaAssetId],
  )

  return {
    exitHistory,
    loadOlderHistoryPages,
    enterHistoryMode,
    selectPreviousRide,
    selectNextRide,
    removeSession,
    selectRide,
  }
}
