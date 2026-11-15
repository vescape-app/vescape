import { create } from 'zustand'
import { getRodeWith } from 'vescape-core'

import {
  NO_RODE_WITH,
  rodeWith,
  rodeWithWindows,
  type RodeWith,
} from '@/modules/group-ride/lib/rodeWith'

interface RodeWithState extends RodeWith {
  /** The ride `riders`/`tracks` belong to, as `start-end` ms. */
  rideKey: string | null
  /** The rider hid the others on the ride map. Kept across rides. */
  hidden: boolean
  /**
   * Who the rider rode with during `[startMs, endMs]`, fetched from the server and held in memory
   * only: Ride History stays local. Signed out or offline the ride simply shows nobody.
   */
  load: (startMs: number, endMs: number) => Promise<void>
  clear: () => void
  toggleHidden: () => void
}

export const useRodeWithStore = create<RodeWithState>((set, get) => ({
  ...NO_RODE_WITH,
  rideKey: null,
  hidden: false,
  load: async (startMs, endMs) => {
    const rideKey = `${startMs}-${endMs}`
    if (get().rideKey === rideKey) return
    set({ ...NO_RODE_WITH, rideKey })
    try {
      const pages = await Promise.all(
        rodeWithWindows(startMs, endMs).map(([from, to]) =>
          getRodeWith(new Date(from).toISOString(), new Date(to).toISOString()),
        ),
      )
      if (get().rideKey === rideKey) set(rodeWith(pages.flat()))
    } catch {
      // Signed out, offline or refused: the ride looks as it does without company.
    }
  },
  clear: () => set({ ...NO_RODE_WITH, rideKey: null }),
  toggleHidden: () => set((s) => ({ hidden: !s.hidden })),
}))
