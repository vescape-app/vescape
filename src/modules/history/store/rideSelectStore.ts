import { create } from 'zustand'
import type { RideExportFormat } from 'vescape-core'

import { EMPTY_RIDE_SELECT, toggleRides, type RideSelect } from '@/modules/history/lib/rideSelect'

interface RideSelectState {
  active: boolean
  select: RideSelect
  /** Last export format, kept for the next export. */
  format: RideExportFormat
  /** Turns select mode on, optionally with rides already ticked (the long-pressed row or day). */
  start: (ids?: readonly string[]) => void
  exit: () => void
  toggle: (ids: readonly string[]) => void
  selectAll: () => void
  setFormat: (format: RideExportFormat) => void
}

export const useRideSelectStore = create<RideSelectState>((set, get) => ({
  active: false,
  select: EMPTY_RIDE_SELECT,
  format: 'gpx',
  start: (ids = []) => set({ active: true, select: toggleRides(EMPTY_RIDE_SELECT, ids) }),
  exit: () => set({ active: false, select: EMPTY_RIDE_SELECT }),
  toggle: (ids) => set({ select: toggleRides(get().select, ids) }),
  selectAll: () => set({ select: { all: true, excluded: new Set() } }),
  setFormat: (format) => set({ format }),
}))
