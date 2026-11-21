import { create } from 'zustand'
import { getDeviceCredentialState } from 'vescape-core'
import { getRodeWith } from 'vescape-core'

import {
  NO_RODE_WITH,
  rodeWith,
  rodeWithWindows,
  type RodeWith,
} from '@/modules/group-ride/lib/rodeWith'

interface RodeWithState extends RodeWith {
  rideKey: string | null
  hidden: boolean
  load: (startMs: number, endMs: number) => Promise<void>
  clear: () => void
  toggleHidden: () => void
}

function viewer() {
  try {
    const credential = getDeviceCredentialState()
    return credential.state === 'ready' ? credential.accountId : null
  } catch {
    return null
  }
}

let generation = 0

export const useRodeWithStore = create<RodeWithState>((set, get) => ({
  ...NO_RODE_WITH,
  rideKey: null,
  hidden: false,
  load: async (startMs, endMs) => {
    const rideKey = `${startMs}-${endMs}`
    if (get().rideKey === rideKey) return
    const current = ++generation
    const account = viewer()
    set({ ...NO_RODE_WITH, rideKey })
    try {
      const pages = await Promise.all(
        rodeWithWindows(startMs, endMs).map(([from, to]) =>
          getRodeWith(new Date(from).toISOString(), new Date(to).toISOString()),
        ),
      )
      if (current === generation && account === viewer()) set(rodeWith(pages.flat()))
    } catch {
      // intentional-suppression: Signed out, offline or refused: the ride looks as it does without company.
    }
  },
  clear: () => {
    generation++
    set({ ...NO_RODE_WITH, rideKey: null })
  },
  toggleHidden: () => set((s) => ({ hidden: !s.hidden })),
}))
