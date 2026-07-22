import { create } from 'zustand'
import type { FocusedSeriesEvent } from 'vescape-core'

/**
 * High-resolution live series for the metrics a `/control` detail chart currently has
 * focused. Native decimates each on fixed-width time buckets (constant scrub resolution)
 * and pushes ~1Hz on `onFocusedSeries`, one event per focused metric. `series[metric]` is
 * a flat `[ts0, v0, ts1, v1, ...]` array; `exclusions[key]` is a flat `[start0, end0, ...]`
 * span list per exclusion key, shared across metrics, for redrawing overlay bands.
 */
interface FocusedSeriesState {
  series: Record<string, number[]>
  exclusions: Record<string, number[]>
  generation: number
  apply: (event: FocusedSeriesEvent) => void
  clearMetric: (metric: string) => void
  clear: () => void
}

const EMPTY_SERIES: Record<string, number[]> = {}
const EMPTY_EXCLUSIONS: Record<string, number[]> = {}

export const useFocusedSeriesStore = create<FocusedSeriesState>((set) => ({
  series: EMPTY_SERIES,
  exclusions: EMPTY_EXCLUSIONS,
  generation: 0,
  apply: (event) =>
    set((state) => ({
      series: { ...state.series, [event.metric]: event.series },
      exclusions: event.exclusions,
      generation: event.generation,
    })),
  clearMetric: (metric) =>
    set((state) => {
      if (!(metric in state.series)) return state
      const series = { ...state.series }
      delete series[metric]
      return { series }
    }),
  clear: () => set({ series: EMPTY_SERIES, exclusions: EMPTY_EXCLUSIONS, generation: 0 }),
}))
