import { create } from 'zustand'
import { getDeviceCredentialState } from 'vescape-core'
import { getFriendRideTrack, getFriendRides, type FriendRide } from 'vescape-core'

import { rodeWithWindows } from '@/modules/group-ride/lib/rodeWith'

/** A Friend's public ride opened on the live map. */
export interface FriendRideTrack {
  /** `accountId-startedAt`: one ride of one Friend. */
  key: string
  accountId: string
  coordinates: [number, number][]
  /** Bumped per open so the map moves to the ride once, not on every render. */
  nonce: number
}

interface FriendRidesState {
  /** Whose rides `rides` are. */
  accountId: string | null
  rides: FriendRide[]
  loading: boolean
  /** The server refused or could not be reached. */
  failed: boolean
  track: FriendRideTrack | null
  /**
   * A Friend's public rides, fetched from the server and held in memory only. Only Friends: the
   * server refuses anyone else, so a stranger's profile never calls this.
   */
  load: (accountId: string) => Promise<void>
  /** Shows the ride on the map, or hides it when it is the one already shown. */
  toggleTrack: (accountId: string, ride: FriendRide) => Promise<void>
  clear: () => void
}

const PUBLIC_RIDE_LIMIT = 5

let nonce = 0

function viewer() {
  try {
    const credential = getDeviceCredentialState()
    return credential.state === 'ready' ? credential.accountId : null
  } catch {
    return null
  }
}

let generation = 0

export const useFriendRidesStore = create<FriendRidesState>((set, get) => ({
  accountId: null,
  rides: [],
  loading: false,
  failed: false,
  track: null,
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
  toggleTrack: async (accountId, ride) => {
    const current = ++generation
    const account = viewer()
    const key = `${accountId}-${ride.startedAt}`
    if (get().track?.key === key) {
      set({ track: null })
      return
    }
    try {
      const windows = rodeWithWindows(Date.parse(ride.startedAt), Date.parse(ride.endedAt))
      const pages = await Promise.all(
        windows.map(([from, to]) =>
          getFriendRideTrack(accountId, new Date(from).toISOString(), new Date(to).toISOString()),
        ),
      )
      const coordinates = pages.flat().map((point): [number, number] => [point.lng, point.lat])
      if (current !== generation || account !== viewer()) return
      set({ track: coordinates.length ? { key, accountId, coordinates, nonce: ++nonce } : null })
    } catch {
      if (current === generation && account === viewer()) set({ failed: true })
    }
  },
  clear: () => {
    generation++
    set({ accountId: null, rides: [], loading: false, failed: false, track: null })
  },
}))
