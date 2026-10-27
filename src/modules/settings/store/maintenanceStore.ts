import { create } from 'zustand'
import type { MaintenanceState } from 'vescape-core'

interface MaintenanceStore {
  /** Native runner state; null until the first read. */
  state: MaintenanceState | null
  setState: (state: MaintenanceState) => void
}

/** A rendered copy of the native Maintenance Job runner; `bootstrap/maintenanceSync` feeds it. */
export const useMaintenanceStore = create<MaintenanceStore>((set) => ({
  state: null,
  setState: (state) => set({ state }),
}))
