import { create } from 'zustand'
import type { RideExportFormat } from 'vescape-core'

import { EMPTY_RIDE_SELECT, toggleRides, type RideSelect } from '@/modules/history/lib/rideSelect'

interface RideSelectState {
  active: boolean
  select: RideSelect
  /** Last export format, kept for the next export. */
  format: RideExportFormat
  start: (firstId?: string) => void
  exit: () => void
  toggle: (ids: readonly string[]) => void
  selectAll: () => void
  setFormat: (format: RideExportFormat) => void
}

export const useRideSelectStore = create<RideSelectState>((set, get) => ({
  active: false,
  select: EMPTY_RIDE_SELECT,
  format: 'gpx',
  start: (firstId) =>
    set({
      active: true,
      select: firstId ? toggleRides(EMPTY_RIDE_SELECT, [firstId]) : EMPTY_RIDE_SELECT,
    }),
  exit: () => set({ active: false, select: EMPTY_RIDE_SELECT }),
  toggle: (ids) => set({ select: toggleRides(get().select, ids) }),
  selectAll: () => set({ select: { all: true, excluded: new Set() } }),
  setFormat: (format) => set({ format }),
}))
