import { create } from 'zustand'
import type { PublicMode } from './fixtures'

/** Local-only sandbox state shared by the social sheet and dashboard map. Never persisted. */
export const usePublicRidePrototypeStore = create<{
  mode: PublicMode
  hours: number
  hidden: string[]
  showRidersOnMap: boolean
  setMode: (mode: PublicMode, hours?: number) => void
  setHidden: (hidden: string[]) => void
  setShowRidersOnMap: (visible: boolean) => void
}>((set) => ({
  mode: 'hours',
  hours: 2,
  hidden: [],
  showRidersOnMap: false,
  setMode: (mode, hours) => set((state) => ({ mode, hours: hours ?? state.hours })),
  setHidden: (hidden) => set({ hidden }),
  setShowRidersOnMap: (showRidersOnMap) => set({ showRidersOnMap }),
}))
