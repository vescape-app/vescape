import { create } from 'zustand'
import {
  acceptFriendRequest,
  deleteFriendRequest,
  getFriends,
  removeFriend,
  sendFriendRequest,
  type Friends,
} from 'vescape-core'

import { friendStartedRiding, friendsErrorMessage } from '@/modules/profile/lib/friends'

const EMPTY: Friends = { friends: [], incoming: [], outgoing: [] }

interface FriendsState {
  lists: Friends
  loaded: boolean
  loading: boolean
  loadError: { message: string; unreachable: boolean } | null
  error: string | null
  friendRiding: boolean
  busy: string[]
  load: () => Promise<void>
  request: (accountId: string) => Promise<void>
  accept: (accountId: string) => Promise<void>
  dismissRequest: (accountId: string) => Promise<void>
  remove: (accountId: string) => Promise<void>
  acknowledgeRiding: () => void
  clear: () => void
}

let generation = 0

export const useFriendsStore = create<FriendsState>((set, get) => {
  async function write(accountId: string, call: () => Promise<unknown>) {
    set((state) => ({ busy: [...state.busy, accountId], error: null }))
    try {
      await call()
      await get().load()
    } catch (error) {
      set({ error: friendsErrorMessage(error) })
    } finally {
      set((state) => ({ busy: state.busy.filter((id) => id !== accountId) }))
    }
  }

  return {
    lists: EMPTY,
    loaded: false,
    loading: false,
    loadError: null,
    error: null,
    friendRiding: false,
    busy: [],

    async load() {
      const current = ++generation
      set({ loading: true })
      try {
        const lists = await getFriends()
        if (current !== generation) return
        const { loaded, lists: previous, friendRiding } = get()
        set({
          lists,
          loaded: true,
          loading: false,
          loadError: null,
          error: null,
          friendRiding:
            friendRiding || (loaded && friendStartedRiding(previous.friends, lists.friends)),
        })
      } catch (error) {
        if (current !== generation) return
        set({
          loading: false,
          loadError: {
            message: friendsErrorMessage(error),
            unreachable: (error as { code?: unknown } | null)?.code === 'RIDER_PROFILE_UNREACHABLE',
          },
        })
      }
    },

    request: (accountId) => write(accountId, () => sendFriendRequest(accountId)),
    accept: (accountId) => write(accountId, () => acceptFriendRequest(accountId)),
    dismissRequest: (accountId) => write(accountId, () => deleteFriendRequest(accountId)),
    remove: (accountId) => write(accountId, () => removeFriend(accountId)),

    acknowledgeRiding() {
      if (get().friendRiding) set({ friendRiding: false })
    },

    clear() {
      generation++
      set({
        lists: EMPTY,
        loaded: false,
        loading: false,
        loadError: null,
        error: null,
        friendRiding: false,
        busy: [],
      })
    },
  }
})
