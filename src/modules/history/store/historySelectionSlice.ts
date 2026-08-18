import type { StoreApi } from 'zustand'
import { getHistoryRange } from 'vescape-core'

import { wait } from '@/helpers/wait'
import type { HistorySession } from '@/modules/history/lib/sessions'
import type { HistoryActions, HistoryStore } from '@/modules/history/store/historyStoreTypes'

const MIN_SESSION_SAMPLE_LIMIT = 10_000
const PREVIEW_SAMPLE_LIMIT = 240
const MIN_SESSION_LOADING_MS = 150

let sessionLoadVersion = 0

function getSessionRangeOptions(session: HistorySession) {
  return {
    fromMs: session.startAtMs,
    toMs: session.endAtMs,
    ...(session.boardId ? { boardId: session.boardId } : {}),
  }
}

function getSessionPreviewLimit(session: HistorySession) {
  return Math.min(PREVIEW_SAMPLE_LIMIT, Math.max(1, session.sampleCount + 1))
}

function getSessionSampleLimit(session: HistorySession) {
  return Math.max(MIN_SESSION_SAMPLE_LIMIT, session.sampleCount + 1)
}

type HistorySelectionSlice = Pick<HistoryActions, 'selectBlock' | 'selectSession'>

type SliceFactory = (
  set: StoreApi<HistoryStore>['setState'],
  get: StoreApi<HistoryStore>['getState'],
) => HistorySelectionSlice

/** Loading the samples behind whichever block or ride the rider opened. */
export const createHistorySelectionSlice: SliceFactory = (set, get) => ({
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
        ...(block.boardId ? { boardId: block.boardId } : {}),
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
        sessionChartSamples: [],
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
      // Cleared, not held: samples and the ride they belong to have to move together. Keeping the
      // previous ride's samples here leaves the charts deriving series, timeline, ranges and paths
      // for the whole old dataset against the new ride's bounds — a full build whose result is
      // thrown away the moment the real samples land. A minute-bucket stand-in had the same
      // problem, cheaply: it drew a coarser shape of the same charts, then drew them again.
      sessionSamples: [],
      sessionChartSamples: [],
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
        sessionChartSamples: range.chartSamples ?? range.boardSamples,
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
})
