import { create } from 'zustand'
import { MOCK_INACTIVE_FRIENDS, type InactiveFriend, type PublicMode } from './fixtures'
import { generateId } from '@/helpers/id'

export interface PublicRideMapRequest {
  riderIds: string[]
  includeSelf: boolean
}

/** Local-only sandbox state shared by the social sheet and dashboard map. Never persisted. */
export const usePublicRidePrototypeStore = create<{
  inactiveFriends: InactiveFriend[]
  addDemoFriend: (name: string) => void
  friendRequests: string[]
  requestFriend: (id: string) => void
  mode: PublicMode
  hours: number
  hidden: string[]
  mapRequest: PublicRideMapRequest | null
  requestMap: (riderIds: string[], includeSelf?: boolean) => void
  clearMapRequest: (request: PublicRideMapRequest) => void
  showRidersOnMap: boolean
  setMode: (mode: PublicMode, hours?: number) => void
  setHidden: (hidden: string[]) => void
  setShowRidersOnMap: (visible: boolean) => void
}>((set) => ({
  inactiveFriends: MOCK_INACTIVE_FRIENDS,
  addDemoFriend: (name) =>
    set((state) => ({
      inactiveFriends: [
        ...state.inactiveFriends,
        { id: generateId(), name: name.trim(), lastSeen: 'Not seen yet' },
      ],
    })),
  friendRequests: [],
  requestFriend: (id) =>
    set((state) => ({
      friendRequests: state.friendRequests.includes(id)
        ? state.friendRequests
        : [...state.friendRequests, id],
    })),
  mode: 'hours',
  hours: 2,
  hidden: [],
  showRidersOnMap: false,
  mapRequest: null,
  requestMap: (riderIds, includeSelf = false) => {
    if (!riderIds.length) return
    set({ showRidersOnMap: true, mapRequest: { riderIds: [...riderIds], includeSelf } })
  },
  clearMapRequest: (request) =>
    set((state) => (state.mapRequest === request ? { mapRequest: null } : state)),
  setMode: (mode, hours) =>
    set((state) => ({
      mode,
      hours: hours ?? state.hours,
      mapRequest: mode === 'off' ? null : state.mapRequest,
    })),
  setHidden: (hidden) => set({ hidden }),
  setShowRidersOnMap: (showRidersOnMap) => set({ showRidersOnMap }),
}))
