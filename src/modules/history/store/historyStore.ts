import { create } from 'zustand'
import {
  getTelemetryHistory,
  getRideHistoryPage,
  getTelemetrySummary,
  clearTelemetryHistory,
  deleteTelemetryRange,
  type HistoryGpsSample,
  type HistoryMarker,
  type TelemetryMinuteBucket,
  type TelemetrySample,
} from 'vescape-core'
import { matchRideSession, type HistorySession } from '@/modules/history/lib/sessions'

import { INITIAL_HISTORY_STATE, type HistoryStore } from '@/modules/history/store/historyStoreTypes'
import { createHistorySelectionSlice } from '@/modules/history/store/historySelectionSlice'

const BUCKET_PAGE_SIZE = 100
const RIDE_PAGE_SIZE = 10
/** Window re-read on every recent refresh, wide enough to cover a ride still being recorded. */
const RECENT_WINDOW_MS = 60 * 60_000
const RECENT_BUCKET_LIMIT = 120
let recentRefreshInFlight = false
let recentRefreshVersion = 0

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  ...INITIAL_HISTORY_STATE,
  ...createHistorySelectionSlice(set, get),

  async loadInitial() {
    set({ loading: true, error: undefined })
    try {
      const [summary, blocks, page] = await Promise.all([
        getTelemetrySummary(),
        getTelemetryHistory({ limit: BUCKET_PAGE_SIZE }),
        getRideHistoryPage({ limit: RIDE_PAGE_SIZE }),
      ])
      set({
        summary,
        blocks,
        sessions: page.sessions,
        selectedBlock: null,
        selectedSession: null,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionChartSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        markers: [],
        sessionTruncated: false,
        hasMore: page.hasMore,
        nextCursorBeforeMs: page.nextCursorBeforeMs,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  async refreshRecent() {
    if (recentRefreshInFlight) return
    recentRefreshInFlight = true
    const version = ++recentRefreshVersion
    try {
      const now = Date.now()
      const [summary, recentBlocks, recentPage] = await Promise.all([
        getTelemetrySummary(),
        getTelemetryHistory({
          fromMs: now - RECENT_WINDOW_MS,
          toMs: now,
          limit: RECENT_BUCKET_LIMIT,
        }),
        getRideHistoryPage({ limit: RIDE_PAGE_SIZE }),
      ])
      if (version !== recentRefreshVersion) return
      set((state) => {
        const known = new Map(state.blocks.map((b) => [b.id, b]))
        for (const block of recentBlocks) {
          known.set(block.id, block)
        }
        const blocks = Array.from(known.values()).sort((a, b) => b.bucketStartMs - a.bucketStartMs)
        const oldestRecent = recentPage.sessions.at(-1)?.startAtMs ?? Number.NEGATIVE_INFINITY
        const olderSessions = state.sessions.filter((session) => session.startAtMs < oldestRecent)
        const sessions = [...recentPage.sessions, ...olderSessions]
        const { selectedSession } = state
        return {
          summary,
          blocks,
          sessions,
          error: undefined,
          selectedSession: selectedSession
            ? (matchRideSession(sessions, selectedSession) ?? selectedSession)
            : selectedSession,
          hasMore: olderSessions.length > 0 ? state.hasMore : recentPage.hasMore,
          nextCursorBeforeMs:
            olderSessions.length > 0 ? state.nextCursorBeforeMs : recentPage.nextCursorBeforeMs,
        }
      })
    } catch (err) {
      if (version !== recentRefreshVersion) return
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      recentRefreshInFlight = false
    }
  },

  async loadMore() {
    const { sessions: loadedSessions, hasMore, loading, nextCursorBeforeMs } = get()
    if (loading || !hasMore || nextCursorBeforeMs == null) return
    set({ loading: true, error: undefined })
    try {
      const page = await getRideHistoryPage({
        limit: RIDE_PAGE_SIZE,
        cursorBeforeMs: nextCursorBeforeMs,
      })
      const known = new Set(loadedSessions.map((session) => session.id))
      const sessions = [
        ...loadedSessions,
        ...page.sessions.filter((session) => !known.has(session.id)),
      ]
      const selectedSession = get().selectedSession
      const nextSelectedSession = selectedSession
        ? matchRideSession(sessions, selectedSession)
        : null
      set({
        sessions,
        selectedSession: nextSelectedSession ?? selectedSession,
        hasMore: page.hasMore,
        nextCursorBeforeMs: page.nextCursorBeforeMs,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  async refreshSummary() {
    try {
      const summary = await getTelemetrySummary()
      set({ summary })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Native owns Ride boundaries; changing the gap invalidates the page cursor and reloads it. */
  regroupSessions() {
    void get().loadInitial()
  },

  async removeSelectedSession() {
    const { selectedSession, sessions } = get()
    if (!selectedSession) return
    const reloadLimit = Math.min(500, Math.max(BUCKET_PAGE_SIZE, get().blocks.length))
    recentRefreshVersion++
    set({ loadingSession: true, error: undefined })
    try {
      await deleteTelemetryRange({
        fromMs: selectedSession.startAtMs,
        toMs: selectedSession.endAtMs,
        deviceId: selectedSession.deviceId,
      })
      const selectedIndex = sessions.findIndex((session) => session.id === selectedSession.id)
      const [blocks, page] = await Promise.all([
        getTelemetryHistory({ limit: reloadLimit }),
        getRideHistoryPage({ limit: Math.min(50, Math.max(RIDE_PAGE_SIZE, sessions.length)) }),
      ])
      const nextSessions = page.sessions
      const nextSelectedSession =
        selectedIndex >= 0
          ? (nextSessions[selectedIndex] ?? nextSessions[selectedIndex - 1] ?? null)
          : null
      const summary = await getTelemetrySummary()
      set({
        summary,
        blocks,
        sessions: nextSessions,
        selectedBlock: null,
        selectedSession: nextSelectedSession,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionChartSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        markers: [],
        sessionTruncated: false,
        hasMore: page.hasMore,
        nextCursorBeforeMs: page.nextCursorBeforeMs,
      })
      if (nextSelectedSession) {
        await get().selectSession(nextSelectedSession)
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loadingSession: false })
    }
  },

  async clearHistory() {
    const reloadLimit = Math.min(500, Math.max(BUCKET_PAGE_SIZE, get().blocks.length))
    recentRefreshVersion++
    set({ loading: true, error: undefined })
    try {
      await clearTelemetryHistory()
      const [blocks, page] = await Promise.all([
        getTelemetryHistory({ limit: reloadLimit }),
        getRideHistoryPage({ limit: RIDE_PAGE_SIZE }),
      ])
      set({
        blocks,
        sessions: page.sessions,
        selectedBlock: null,
        selectedSession: null,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionChartSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        markers: [],
        sessionTruncated: false,
        summary: await getTelemetrySummary(),
        hasMore: page.hasMore,
        nextCursorBeforeMs: page.nextCursorBeforeMs,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },
}))

export type {
  HistoryGpsSample,
  HistoryMarker,
  HistorySession,
  TelemetryMinuteBucket,
  TelemetrySample,
}
