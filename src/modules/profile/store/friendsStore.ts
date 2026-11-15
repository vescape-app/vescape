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
  /** Server truth as last fetched; empty while signed out or before the first answer. */
  lists: Friends
  loaded: boolean
  error: string | null
  /** A friend started riding since the rider last opened Social. Lights the Social button. */
  friendRiding: boolean
  /** Account ids with a call in flight, so their buttons wait. */
  busy: string[]
  load: () => Promise<void>
  request: (accountId: string) => Promise<void>
  accept: (accountId: string) => Promise<void>
  /** Declines an incoming request or withdraws an outgoing one. */
  dismissRequest: (accountId: string) => Promise<void>
  /** Silent: the other side is not told. */
  remove: (accountId: string) => Promise<void>
  acknowledgeRiding: () => void
  clear: () => void
}

let generation = 0

/** JS view of the server-owned Friends of the signed-in Account. */
export const useFriendsStore = create<FriendsState>((set, get) => {
  /** Runs one write, then refetches: the server decides what the lists look like after it. */
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
    error: null,
    friendRiding: false,
    busy: [],

    async load() {
      const current = ++generation
      try {
        const lists = await getFriends()
        if (current !== generation) return
        const { loaded, lists: previous, friendRiding } = get()
        set({
          lists,
          loaded: true,
          error: null,
          // The first answer is a baseline, not a change.
          friendRiding:
            friendRiding || (loaded && friendStartedRiding(previous.friends, lists.friends)),
        })
      } catch (error) {
        if (current === generation) set({ error: friendsErrorMessage(error) })
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
      set({ lists: EMPTY, loaded: false, error: null, friendRiding: false, busy: [] })
    },
  }
})
