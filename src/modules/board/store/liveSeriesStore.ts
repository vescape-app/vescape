import { create } from 'zustand'

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
