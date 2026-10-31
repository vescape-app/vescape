import type {
  HistoryGpsSample,
  HistoryMarker,
  MetricExclusion,
  TelemetryMinuteBucket,
  TelemetrySample,
  TelemetrySummary,
} from 'vescape-core'

import type { HistorySession } from '@/modules/history/lib/sessions'
import type { RideFocus } from '@/navigation/links'

export interface HistoryState {
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  selectedBlock: TelemetryMinuteBucket | null
  selectedSession: HistorySession | null
  /** Where the selected ride should open once its samples land; cleared once applied. */
  sessionFocus: RideFocus | null
  samples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  sessionSamples: TelemetrySample[]
  sessionChartSamples: TelemetrySample[]
  sessionGpsSamples: HistoryGpsSample[]
  sessionMarkers: HistoryMarker[]
  sessionExclusions: MetricExclusion[]
  markers: HistoryMarker[]
  summary: TelemetrySummary | null
  loading: boolean
  loadingSamples: boolean
  loadingSession: boolean
  sessionTruncated: boolean
  error: string | undefined
  hasMore: boolean
  nextCursorBeforeMs: number | null
}

export interface HistoryActions {
  loadInitial: () => Promise<void>
  loadMore: () => Promise<void>
  refreshRecent: () => Promise<void>
  /** Re-read every loaded ride in place after native rewrote summaries; keeps the selection. */
  reloadLoadedSessions: () => Promise<void>
  selectBlock: (block: TelemetryMinuteBucket | null) => Promise<void>
  selectSession: (session: HistorySession | null, focus?: RideFocus | null) => Promise<void>
  /** The panel applied `sessionFocus`. */
  clearSessionFocus: () => void
  refreshSummary: () => Promise<void>
  regroupSessions: () => void
  removeSelectedSession: () => Promise<void>
  clearHistory: () => Promise<void>
}

export type HistoryStore = HistoryState & HistoryActions

export const INITIAL_HISTORY_STATE: HistoryState = {
  blocks: [],
  sessions: [],
  selectedBlock: null,
  selectedSession: null,
  sessionFocus: null,
  samples: [],
  gpsSamples: [],
  sessionSamples: [],
  sessionChartSamples: [],
  sessionGpsSamples: [],
  sessionMarkers: [],
  sessionExclusions: [],
  markers: [],
  summary: null,
  loading: false,
  loadingSamples: false,
  loadingSession: false,
  sessionTruncated: false,
  error: undefined,
  hasMore: true,
  nextCursorBeforeMs: null,
}
