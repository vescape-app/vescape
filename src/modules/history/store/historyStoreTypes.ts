import type {
  HistoryGpsSample,
  HistoryMarker,
  MetricExclusion,
  TelemetryMinuteBucket,
  TelemetrySample,
  TelemetrySummary,
} from 'vescape-core'

import type { HistorySession } from '@/modules/history/lib/sessions'

export interface HistoryState {
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  liveBlocks: TelemetryMinuteBucket[]
  selectedBlock: TelemetryMinuteBucket | null
  selectedSession: HistorySession | null
  samples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  sessionSamples: TelemetrySample[]
  sessionChartSamples: TelemetrySample[]
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

export interface HistoryActions {
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

export type HistoryStore = HistoryState & HistoryActions

export const INITIAL_HISTORY_STATE: HistoryState = {
  blocks: [],
  sessions: [],
  liveBlocks: [],
  selectedBlock: null,
  selectedSession: null,
  samples: [],
  gpsSamples: [],
  sessionSamples: [],
  sessionChartSamples: [],
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
}
