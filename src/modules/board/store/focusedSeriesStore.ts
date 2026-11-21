import { create } from 'zustand'
import type { FocusedSeriesEvent } from 'vescape-core'
import { omitKey } from '@/helpers/records'

interface FocusedSeriesState {
  series: Record<string, number[]>
  exclusions: Record<string, number[]>
  spanMs: number
  sampleRateHz: number
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
  spanMs: 0,
  sampleRateHz: 0,
  generation: 0,
  apply: (event) =>
    set((state) => ({
      series: { ...state.series, [event.metric]: event.series },
      exclusions: event.exclusions,
      spanMs: event.spanMs,
      sampleRateHz: event.sampleRateHz,
      generation: event.generation,
    })),
  clearMetric: (metric) =>
    set((state) => {
      if (!(metric in state.series)) return state
      return { series: omitKey(state.series, metric) }
    }),
  clear: () =>
    set({
      series: EMPTY_SERIES,
      exclusions: EMPTY_EXCLUSIONS,
      spanMs: 0,
      sampleRateHz: 0,
      generation: 0,
    }),
}))
