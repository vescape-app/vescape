import type {
  HistoryGpsSample,
  HistoryMarker,
  MetricExclusion,
  RideSelection,
  TelemetryMinuteBucket,
  TelemetrySample,
  TelemetrySummary,
} from 'vescape-core'

import type { HistorySession } from '@/modules/history/lib/sessions'
import type { RideFilterSelection } from '@/modules/history/lib/rideFilter'
import type { RideFocus } from '@/modules/history/lib/chartFocus'

export interface HistoryState {
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  selectedBlock: TelemetryMinuteBucket | null
  selectedSession: HistorySession | null
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
  reloadLoadedSessions: () => Promise<void>
  selectBlock: (block: TelemetryMinuteBucket | null) => Promise<void>
  selectSession: (session: HistorySession | null, focus?: RideFocus | null) => Promise<void>
  clearSessionFocus: () => void
  refreshSummary: () => Promise<void>
  regroupSessions: () => void
  setRideFilter: (selection: RideFilterSelection) => void
  removeSelectedSession: () => Promise<void>
  removeRides: (selection: RideSelection) => Promise<void>
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
