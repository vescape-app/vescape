import { create } from 'zustand'
import {
  getTelemetryHistory,
  getHistoryRange,
  getTelemetrySummary,
  clearTelemetryHistory,
  deleteTelemetryRange,
  type HistoryGpsSample,
  type HistoryMarker,
  type MetricExclusion,
  type TelemetryMinuteBucket,
  type TelemetrySample,
  type TelemetrySummary,
} from 'vescape-core'
import { groupHistorySessions, type HistorySession } from '@/modules/history/lib/sessions'
import { wait } from '@/helpers/wait'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

interface HistoryState {
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  liveBlocks: TelemetryMinuteBucket[]
  selectedBlock: TelemetryMinuteBucket | null
  selectedSession: HistorySession | null
  samples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  sessionSamples: TelemetrySample[]
  sessionGpsSamples: HistoryGpsSample[]
  sessionMarkers: HistoryMarker[]
  sessionExclusions: MetricExclusion[]
  liveSamples: TelemetrySample[]
  liveGpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  summary: TelemetrySummary | null
  loading: boolean
  loadingSamples: boolean
  loadingSession: boolean
  sessionTruncated: boolean
  error: string | undefined
  hasMore: boolean
}

interface HistoryActions {
  loadInitial: () => Promise<void>
  loadMore: () => Promise<void>
  refreshLive: () => Promise<void>
  selectBlock: (block: TelemetryMinuteBucket | null) => Promise<void>
  selectSession: (session: HistorySession | null) => Promise<void>
  refreshSummary: () => Promise<void>
  regroupSessions: () => void
  removeSelectedSession: () => Promise<void>
  clearHistory: () => Promise<void>
}

const PAGE_SIZE = 100
const MIN_SESSION_SAMPLE_LIMIT = 10_000
const PREVIEW_SAMPLE_LIMIT = 240
const MIN_SESSION_LOADING_MS = 150
let liveRefreshInFlight = false
let liveRefreshVersion = 0
let sessionLoadVersion = 0

/** Rider-set ride split gap. Read per grouping call so a settings change re-groups on next load. */
function rideSplitGapMs() {
  return useSettingsStore.getState().rideSplitGapMinutes * 60_000
}

function getSessionRangeOptions(session: HistorySession) {
  return {
    fromMs: session.startAtMs,
    toMs: session.endAtMs,
    ...(session.deviceId ? { deviceId: session.deviceId } : {}),
  }
}

function getSessionPreviewLimit(session: HistorySession) {
  return Math.min(PREVIEW_SAMPLE_LIMIT, Math.max(1, session.sampleCount + 1))
}

function getSessionSampleLimit(session: HistorySession) {
  return Math.max(MIN_SESSION_SAMPLE_LIMIT, session.sampleCount + 1)
}

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  blocks: [],
  sessions: [],
  liveBlocks: [],
  selectedBlock: null,
  selectedSession: null,
  samples: [],
  gpsSamples: [],
  sessionSamples: [],
  sessionGpsSamples: [],
  sessionMarkers: [],
  sessionExclusions: [],
  liveSamples: [],
  liveGpsSamples: [],
  markers: [],
  summary: null,
  loading: false,
  loadingSamples: false,
  loadingSession: false,
  sessionTruncated: false,
  error: undefined,
  hasMore: true,

  async loadInitial() {
    set({ loading: true, error: undefined })
    try {
      const [summary, blocks] = await Promise.all([
        getTelemetrySummary(),
        getTelemetryHistory({ limit: PAGE_SIZE }),
      ])
      set({
        summary,
        blocks,
        sessions: groupHistorySessions(blocks, { gapMs: rideSplitGapMs() }),
        liveBlocks: blocks.slice(0, useSettingsStore.getState().liveHistoryLimit),
        selectedBlock: null,
        selectedSession: null,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        markers: [],
        sessionTruncated: false,
        hasMore: blocks.length === PAGE_SIZE,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  async refreshLive() {
    if (liveRefreshInFlight) return
    liveRefreshInFlight = true
    const version = ++liveRefreshVersion
    try {
      const now = Date.now()
      const limit = useSettingsStore.getState().liveHistoryLimit
      const fromMs = now - 10 * 60_000
      const [summary, liveBlocks, range] = await Promise.all([
        getTelemetrySummary(),
        getTelemetryHistory({ fromMs, toMs: now, limit }),
        getHistoryRange({ fromMs, toMs: now, limit: 120 }),
      ])
      if (version !== liveRefreshVersion) return
      set((state) => {
        const known = new Map(state.blocks.map((b) => [b.id, b]))
        for (const block of liveBlocks) {
          known.set(block.id, block)
        }
        const blocks = Array.from(known.values()).sort((a, b) => b.bucketStartMs - a.bucketStartMs)
        return {
          summary,
          liveBlocks,
          liveSamples: range.boardSamples,
          liveGpsSamples: range.gpsSamples,
          blocks,
          sessions: groupHistorySessions(blocks, { gapMs: rideSplitGapMs() }),
        }
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      liveRefreshInFlight = false
    }
  },

  async loadMore() {
    const { blocks, hasMore, loading } = get()
    if (loading || !hasMore || blocks.length === 0) return
    set({ loading: true, error: undefined })
    try {
      const cursorBeforeMs = Math.min(...blocks.map((b) => b.bucketStartMs)) - 1
      const next = await getTelemetryHistory({
        limit: PAGE_SIZE,
        cursorBeforeMs,
      })
      const ids = new Set(blocks.map((b) => b.id))
      const merged = [...blocks, ...next.filter((b) => !ids.has(b.id))]
      const sessions = groupHistorySessions(merged, { gapMs: rideSplitGapMs() })
      const selectedSession = get().selectedSession
      const nextSelectedSession = selectedSession
        ? sessions.find(
            (session) =>
              session.id === selectedSession.id ||
              (session.deviceId === selectedSession.deviceId &&
                session.startAtMs <= selectedSession.endAtMs &&
                session.endAtMs >= selectedSession.startAtMs),
          )
        : null
      set({
        blocks: merged,
        sessions,
        selectedSession: nextSelectedSession ?? selectedSession,
        hasMore: next.length === PAGE_SIZE,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  async selectBlock(block) {
    if (!block) {
      set({
        selectedBlock: null,
        samples: [],
        gpsSamples: [],
        markers: [],
        loadingSamples: false,
      })
      return
    }
    set({
      selectedBlock: block,
      samples: [],
      gpsSamples: [],
      markers: [],
      loadingSamples: true,
      error: undefined,
    })
    try {
      const range = await getHistoryRange({
        fromMs: block.startAtMs,
        toMs: block.endAtMs,
        ...(block.deviceId ? { deviceId: block.deviceId } : {}),
        limit: 500,
      })
      set({
        samples: range.boardSamples,
        gpsSamples: range.gpsSamples,
        markers: range.markers,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loadingSamples: false })
    }
  },

  async selectSession(session) {
    const version = ++sessionLoadVersion
    if (!session) {
      set({
        selectedSession: null,
        sessionSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        loadingSession: false,
        sessionTruncated: false,
      })
      return
    }
    set({
      selectedSession: session,
      // The previous ride's lines stay up until the real samples land. A minute-bucket stand-in
      // used to fill the gap, but it drew a different, coarser shape of the same charts — the
      // stack rebuilt twice and neither drawing was the ride.
      sessionSamples: get().sessionSamples,
      sessionGpsSamples: [],
      loadingSession: true,
      sessionTruncated: false,
      error: undefined,
    })
    const minimumLoading = wait(MIN_SESSION_LOADING_MS)
    try {
      const rangeOptions = getSessionRangeOptions(session)
      if (session.centerLatitude == null || session.centerLongitude == null) {
        const previewRange = await getHistoryRange({
          ...rangeOptions,
          limit: getSessionPreviewLimit(session),
        })
        if (version !== sessionLoadVersion) return
        if (previewRange.gpsSamples.length > 0) {
          set({ sessionGpsSamples: previewRange.gpsSamples })
        }
      }
      const range = await getHistoryRange({
        ...rangeOptions,
        limit: getSessionSampleLimit(session),
      })
      await minimumLoading
      if (version !== sessionLoadVersion) return
      set({
        sessionSamples: range.boardSamples,
        sessionGpsSamples: range.gpsSamples,
        sessionMarkers: range.markers,
        sessionExclusions: range.exclusions,
        sessionTruncated:
          range.boardSamples.length < session.sampleCount ||
          range.gpsSamples.length < session.gpsPointCount,
      })
    } catch (err) {
      await minimumLoading
      if (version === sessionLoadVersion) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      await minimumLoading
      if (version === sessionLoadVersion) {
        set({ loadingSession: false })
      }
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

  /** Re-group the loaded blocks after the ride split gap changed. Grouping is read-time, no reload. */
  regroupSessions() {
    const { blocks, selectedSession } = get()
    if (!blocks.length) return
    const sessions = groupHistorySessions(blocks, { gapMs: rideSplitGapMs() })
    set({
      sessions,
      // A merged/split ride keeps a matching id only by luck; drop a selection that no longer exists.
      selectedSession:
        selectedSession && sessions.some((session) => session.id === selectedSession.id)
          ? selectedSession
          : null,
    })
  },

  async removeSelectedSession() {
    const { selectedSession, sessions } = get()
    if (!selectedSession) return
    const reloadLimit = Math.min(500, Math.max(PAGE_SIZE, get().blocks.length))
    liveRefreshVersion++
    set({ loadingSession: true, error: undefined })
    try {
      await deleteTelemetryRange({
        fromMs: selectedSession.startAtMs,
        toMs: selectedSession.endAtMs,
        deviceId: selectedSession.deviceId,
      })
      const selectedIndex = sessions.findIndex((session) => session.id === selectedSession.id)
      const blocks = await getTelemetryHistory({ limit: reloadLimit })
      const liveBlocks = blocks.slice(0, useSettingsStore.getState().liveHistoryLimit)
      const nextSessions = groupHistorySessions(blocks, { gapMs: rideSplitGapMs() })
      const nextSelectedSession =
        selectedIndex >= 0
          ? (nextSessions[selectedIndex] ?? nextSessions[selectedIndex - 1] ?? null)
          : null
      const summary = await getTelemetrySummary()
      set({
        summary,
        blocks,
        liveBlocks,
        sessions: nextSessions,
        selectedBlock: null,
        selectedSession: nextSelectedSession,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        markers: [],
        sessionTruncated: false,
        hasMore: blocks.length === reloadLimit,
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
    const reloadLimit = Math.min(500, Math.max(PAGE_SIZE, get().blocks.length))
    liveRefreshVersion++
    set({ loading: true, error: undefined })
    try {
      await clearTelemetryHistory()
      const blocks = await getTelemetryHistory({ limit: reloadLimit })
      set({
        blocks,
        sessions: groupHistorySessions(blocks, { gapMs: rideSplitGapMs() }),
        liveBlocks: blocks.slice(0, useSettingsStore.getState().liveHistoryLimit),
        selectedBlock: null,
        selectedSession: null,
        samples: [],
        gpsSamples: [],
        sessionSamples: [],
        sessionGpsSamples: [],
        sessionMarkers: [],
        sessionExclusions: [],
        liveSamples: [],
        liveGpsSamples: [],
        markers: [],
        sessionTruncated: false,
        summary: await getTelemetrySummary(),
        hasMore: blocks.length === reloadLimit,
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
