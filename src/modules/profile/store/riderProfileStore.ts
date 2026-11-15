import { create } from 'zustand'
import { getDeviceCredentialState } from 'vescape-core'
import { getRiderProfile, saveRiderProfile, type RiderProfile } from 'vescape-core'

import {
  riderProfileErrorMessage,
  type RiderProfileDraft,
} from '@/modules/profile/lib/riderProfile'

interface RiderProfileState {
  /** The signed-in Account's server profile; null while signed out, loading, or before a nick. */
  profile: RiderProfile | null
  /** True once the server answered for the current account (so `profile: null` means "no nick"). */
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  /** Rejects with the rider-facing reason; the caller shows it next to the field. */
  save: (draft: RiderProfileDraft) => Promise<RiderProfile>
  /** Forget the profile on sign-out. */
  clear: () => void
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

/**
 * JS view of the server-owned Rider Profile. Once loaded with a nick, that nick is the rider's
 * name everywhere.
 */
export const useRiderProfileStore = create<RiderProfileState>((set) => ({
  profile: null,
  loaded: false,
  error: null,

  async load() {
    const current = ++generation
    const account = viewer()
    try {
      const profile = await getRiderProfile()
      if (current === generation && account === viewer())
        set({ profile, loaded: true, error: null })
    } catch (error) {
      if (current === generation && account === viewer())
        set({ error: riderProfileErrorMessage(error) })
    }
  },

  async save(draft) {
    const current = ++generation
    const account = viewer()
    try {
      const profile = await saveRiderProfile(draft.nick, draft.nationality)
      if (current !== generation || account !== viewer()) throw new Error('Account changed')
      set({ profile, loaded: true, error: null })
      return profile
    } catch (error) {
      if (current !== generation || account !== viewer()) throw new Error('Account changed')
      throw new Error(riderProfileErrorMessage(error))
    }
  },

  clear() {
    generation++
    set({ profile: null, loaded: false, error: null })
  },
}))
