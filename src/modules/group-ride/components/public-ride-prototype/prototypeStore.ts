import { create } from 'zustand'
import type { PublicMode } from './fixtures'

/** Local-only sandbox state shared by the social sheet and dashboard map. Never persisted. */
export const usePublicRidePrototypeStore = create<{
  mode: PublicMode
  hidden: string[]
  showRidersOnMap: boolean
  setMode: (mode: PublicMode) => void
  setHidden: (hidden: string[]) => void
  setShowRidersOnMap: (visible: boolean) => void
}>((set) => ({
  mode: 'ride',
  hidden: [],
  showRidersOnMap: false,
  setMode: (mode) => set({ mode }),
  setHidden: (hidden) => set({ hidden }),
  setShowRidersOnMap: (showRidersOnMap) => set({ showRidersOnMap }),
}))
