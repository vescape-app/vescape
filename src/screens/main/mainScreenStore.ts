import { create } from 'zustand'

import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import type { MainViewState } from '@/screens/main/mainViewState'

export type MapSelector = 'navigation' | 'style' | null

/** Which list the history screen shows: recorded rides, or the Favorites the rider starred. */
export type HistoryTab = 'history' | 'favorites'

/** The time span a rider is trimming into a Favorite. Non-null means trim mode is active. */
export interface TrimRange {
  startMs: number
  endMs: number
}

interface MainScreenState {
  mode: MainViewState
  historyTab: HistoryTab
  /** The Favorite whose detail is open, or null while the Favorites list is showing. */
  openFavoriteId: string | null
  historySheetVisible: boolean
  mapSelector: MapSelector
  perspectiveEnabled: boolean
  trimRange: TrimRange | null
  activeHistoryMapMetric: HistoryMetricKey
}

interface MainScreenActions {
  reset: () => void
  enterTelemetry: () => void
  enterMap: () => void
  enterWeather: () => void
  enterLegalLimits: () => void
  enterHistory: () => void
  setHistoryTab: (tab: HistoryTab) => void
  /** Open one Favorite's detail. */
  openFavorite: (id: string) => void
  /** Back to the Favorites list. */
  closeFavorite: () => void
  setHistorySheetVisible: (visible: boolean) => void
  setMapSelector: (selector: MapSelector) => void
  dismissMapSelector: () => void
  setPerspectiveEnabled: (enabled: boolean) => void
  /** Enter trim mode seeded with a default range (the ride's full Moving Window). */
  beginTrim: (range: TrimRange) => void
  /** Live-update the trimmed span while a handle is dragged. */
  setTrimRange: (range: TrimRange) => void
  /** Leave trim mode (save or cancel). */
  endTrim: () => void
  setActiveHistoryMapMetric: (metric: HistoryMetricKey) => void
}

const initialState: MainScreenState = {
  mode: 'telemetry',
  historyTab: 'history',
  openFavoriteId: null,
  historySheetVisible: false,
  mapSelector: null,
  perspectiveEnabled: true,
  trimRange: null,
  activeHistoryMapMetric: 'speed',
}

export const useMainScreenStore = create<MainScreenState & MainScreenActions>((set) => ({
  ...initialState,

  reset() {
    set(initialState)
  },

  enterTelemetry() {
    set({
      mode: 'telemetry',
      historySheetVisible: false,
      mapSelector: null,
      trimRange: null,
      openFavoriteId: null,
    })
  },

  enterMap() {
    set({ mode: 'map', mapSelector: null })
  },

  enterWeather() {
    set({ mode: 'weather', mapSelector: null })
  },

  enterLegalLimits() {
    set({ mode: 'legalLimits', mapSelector: null })
  },

  enterHistory() {
    set({ mode: 'history', mapSelector: null })
  },

  setHistoryTab(tab) {
    set((state) =>
      state.historyTab === tab
        ? state
        : {
            historyTab: tab,
            historySheetVisible: false,
            openFavoriteId: null,
            trimRange: null,
          },
    )
  },

  openFavorite(id) {
    set({ openFavoriteId: id, historySheetVisible: false, trimRange: null })
  },

  closeFavorite() {
    set((state) => (state.openFavoriteId === null ? state : { openFavoriteId: null }))
  },

  setHistorySheetVisible(visible) {
    set({ historySheetVisible: visible })
  },

  setMapSelector(selector) {
    set((state) => (state.mapSelector === selector ? state : { mapSelector: selector }))
  },

  dismissMapSelector() {
    set((state) => (state.mapSelector === null ? state : { mapSelector: null }))
  },

  setPerspectiveEnabled(enabled) {
    set({ perspectiveEnabled: enabled })
  },

  beginTrim(range) {
    set({ trimRange: range })
  },

  setTrimRange(range) {
    set((state) =>
      state.trimRange &&
      state.trimRange.startMs === range.startMs &&
      state.trimRange.endMs === range.endMs
        ? state
        : { trimRange: range },
    )
  },

  endTrim() {
    set((state) => (state.trimRange === null ? state : { trimRange: null }))
  },

  setActiveHistoryMapMetric(metric) {
    set((state) =>
      state.activeHistoryMapMetric === metric ? state : { activeHistoryMapMetric: metric },
    )
  },
}))
