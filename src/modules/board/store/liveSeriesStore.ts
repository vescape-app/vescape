import { create } from 'zustand'

/**
 * Decimated per-metric series, computed natively and pushed ~1Hz. Each metric is a flat
 * `[ts0, v0, ts1, v1, ...]` array. The battery bar and the telemetry panel read this instead of
 * projecting/decimating the full sample window on the JS thread. Keys are the native
 * `LIVE_SERIES_METRICS` plus whatever `acquireLiveSeries` holds.
 */
interface LiveSeriesState {
  metrics: Record<string, number[]>
  generation: number
  setSeries: (metrics: Record<string, number[]>, generation: number) => void
  clear: () => void
}

const EMPTY: Record<string, number[]> = {}

export const useLiveSeriesStore = create<LiveSeriesState>((set) => ({
  metrics: EMPTY,
  generation: 0,
  setSeries: (metrics, generation) => set({ metrics, generation }),
  clear: () => set({ metrics: EMPTY, generation: 0 }),
}))
