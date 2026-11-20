import { create } from 'zustand'
import { getDeviceCredentialState, getFriendRides, type FriendRide } from 'vescape-core'

interface FriendRidesState {
  /** Whose rides `rides` are. */
  accountId: string | null
  rides: FriendRide[]
  loading: boolean
  /** The server refused or could not be reached. */
  failed: boolean
  /**
   * Public rides for a Friend or the signed-in rider, fetched from the server and held in memory
   * only. The server refuses non-friends, so a stranger's profile never calls this.
   */
  load: (accountId: string) => Promise<void>
  clear: () => void
}

const PUBLIC_RIDE_LIMIT = 5

function viewer() {
  try {
    const credential = getDeviceCredentialState()
    return credential.state === 'ready' ? credential.accountId : null
  } catch {
    return null
  }
}

let generation = 0

export const useFriendRidesStore = create<FriendRidesState>((set) => ({
  accountId: null,
  rides: [],
  loading: false,
  failed: false,
  load: async (accountId) => {
    const current = ++generation
    const account = viewer()
    set({ accountId, rides: [], loading: true, failed: false })
    try {
      const { rides } = await getFriendRides(accountId, PUBLIC_RIDE_LIMIT)
      if (current === generation && account === viewer()) {
        set({ rides: rides.slice(0, PUBLIC_RIDE_LIMIT), loading: false })
      }
    } catch {
      if (current === generation && account === viewer()) set({ loading: false, failed: true })
    }
  },
  clear: () => {
    generation++
    set({ accountId: null, rides: [], loading: false, failed: false })
  },
}))
