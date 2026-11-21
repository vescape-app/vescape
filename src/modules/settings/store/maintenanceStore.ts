import { create } from 'zustand'
import type { MaintenanceState } from 'vescape-core'

interface MaintenanceStore {
  state: MaintenanceState | null
  setState: (state: MaintenanceState) => void
}

export const useMaintenanceStore = create<MaintenanceStore>((set) => ({
  state: null,
  setState: (state) => set({ state }),
}))
