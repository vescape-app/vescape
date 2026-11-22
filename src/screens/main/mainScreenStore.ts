import { create } from 'zustand'

import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import type { MainViewState } from '@/screens/main/mainViewState'

export type MapSelector = 'navigation' | 'style' | null

export type HistoryTab = 'history' | 'favorites'

export interface TrimRange {
  startMs: number
  endMs: number
}

interface MainScreenState {
  mode: MainViewState
  historyTab: HistoryTab
  openFavoriteId: string | null
  historySheetVisible: boolean
  mapSelector: MapSelector
  perspectiveEnabled: boolean
  historyPanelHeight: number
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
  openFavorite: (id: string) => void
  closeFavorite: () => void
  setHistorySheetVisible: (visible: boolean) => void
  setMapSelector: (selector: MapSelector) => void
  dismissMapSelector: () => void
  setPerspectiveEnabled: (enabled: boolean) => void
  setHistoryPanelHeight: (height: number) => void
  beginTrim: (range: TrimRange) => void
  setTrimRange: (range: TrimRange) => void
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
  historyPanelHeight: 0,
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

  setHistoryPanelHeight(height) {
    set((state) => (state.historyPanelHeight === height ? state : { historyPanelHeight: height }))
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
