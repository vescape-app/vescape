import { create } from 'zustand'
import type { RideHistoryFilter } from 'vescape-core'

import {
  EMPTY_RIDE_FILTER,
  toRideHistoryFilter,
  type RideFilterSelection,
} from '@/modules/history/lib/rideFilter'

interface HistoryFilterStore {
  /** In-memory only: the filter lasts while the app runs and resets on restart. */
  selection: RideFilterSelection
  setSelection: (selection: RideFilterSelection) => void
}

export const useHistoryFilterStore = create<HistoryFilterStore>((set) => ({
  selection: EMPTY_RIDE_FILTER,
  setSelection: (selection) => set({ selection }),
}))

export function getRideFilter(): RideHistoryFilter {
  return toRideHistoryFilter(useHistoryFilterStore.getState().selection)
}
