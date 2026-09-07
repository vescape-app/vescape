import { create } from 'zustand'
import { getSettings, updateSetting } from 'vescape-core'

import { generateId } from '@/helpers/id'

interface RiderState {
  /** Persistent device-scoped anonymous Rider id. Null until loaded. */
  riderId: string | null
  /** Rider-chosen display name, or null when unset. */
  riderName: string | null
  /** Rider-chosen marker color (hex), or null when unset. */
  riderColor: string | null
  loaded: boolean
  error: string | null
  /** Load identity from native settings, generating a Rider id on first use. */
  load: () => Promise<void>
  /** Set the display name (trimmed; empty clears it back to null). */
  setName: (name: string) => Promise<void>
  /** Set the marker color (hex); null clears it. */
  setColor: (color: string | null) => Promise<void>
}
let identityWriteQueue: Promise<void> = Promise.resolve()
let identityLoad: Promise<void> | null = null

function enqueueIdentityWrite(task: () => Promise<void>): Promise<void> {
  const operation = identityWriteQueue.then(task)
  // intentional-suppression: returned operation rejects to the rider UI owner
  identityWriteQueue = operation.catch(() => undefined) // Returned operation still rejects to its UI owner.
  return operation
}

export const useRiderStore = create<RiderState>((set) => ({
  riderId: null,
  riderName: null,
  riderColor: null,
  loaded: false,
  error: null,

  load() {
    if (identityLoad != null) return identityLoad
    identityLoad = enqueueIdentityWrite(async () => {
      try {
        const settings = await getSettings()
        let riderId = settings.riderId
        if (!riderId) {
          riderId = generateId()
          await updateSetting('riderId', riderId)
        }
        set({
          riderId,
          riderName: settings.riderName ?? null,
          riderColor: settings.riderColor ?? null,
          loaded: true,
          error: null,
        })
      } catch {
        set({ loaded: false, error: 'Your rider identity could not be loaded.' })
      }
    })
    identityLoad.finally(() => {
      identityLoad = null
    })
    return identityLoad
  },

  setName(name) {
    const trimmed = name.trim()
    const value = trimmed.length ? trimmed : null
    return enqueueIdentityWrite(async () => {
      try {
        await updateSetting('riderName', value)
        set({ riderName: value, error: null })
      } catch (error) {
        set({ error: 'Your name could not be saved.' })
        throw error
      }
    })
  },

  setColor(color) {
    return enqueueIdentityWrite(async () => {
      try {
        await updateSetting('riderColor', color)
        set({ riderColor: color, error: null })
      } catch (error) {
        set({ error: 'Your color could not be saved.' })
        throw error
      }
    })
  },
}))
