import { useMemo } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addAccessoryStateListener,
  enrollAccessory as nativeEnroll,
  forgetAccessory as nativeForget,
  getAccessories as nativeGetAccessories,
  type AccessoryEnrollment,
  type SavedAccessory,
} from 'vescape-core'

interface AccessoryState {
  accessories: SavedAccessory[]
  enrolling: string | null
}

interface AccessoryActions {
  sync: () => void
  enroll: (deviceId: string) => Promise<AccessoryEnrollment>
  forget: (accessoryId: string) => Promise<boolean>
}

export const useAccessoryStore = create<AccessoryState & AccessoryActions>((set) => ({
  accessories: [],
  enrolling: null,

  sync: () => {
    set({ accessories: nativeGetAccessories() })
  },

  enroll: async (deviceId) => {
    set({ enrolling: deviceId })
    try {
      return await nativeEnroll(deviceId)
    } finally {
      set((state) => ({ enrolling: state.enrolling === deviceId ? null : state.enrolling }))
    }
  },

  forget: (accessoryId) => nativeForget(accessoryId),
}))

let subscription: { remove(): void } | null = null
let appStateSubscription: { remove(): void } | null = null

export function startAccessoryStateMirror(): () => void {
  subscription?.remove()
  appStateSubscription?.remove()
  subscription = addAccessoryStateListener(({ accessories }) => {
    useAccessoryStore.setState({ accessories })
  })
  appStateSubscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') useAccessoryStore.getState().sync()
  })
  useAccessoryStore.getState().sync()
  return () => {
    subscription?.remove()
    subscription = null
    appStateSubscription?.remove()
    appStateSubscription = null
  }
}

export function useSavedAccessory(accessoryId: string): SavedAccessory | undefined {
  return useAccessoryStore((s) => s.accessories.find((a) => a.accessoryId === accessoryId))
}

export function useConnectedAccessories(): SavedAccessory[] {
  const accessories = useAccessoryStore((s) => s.accessories)
  return useMemo(() => accessories.filter((a) => a.phase === 'connected'), [accessories])
}

export function accessoryNeedsSetup(accessory: SavedAccessory): boolean {
  return accessory.capabilitiesChanged || accessory.compatibility === 'unsupported-capabilities'
}
