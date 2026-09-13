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
  /** Every enrolled Accessory, in the order native reports them. */
  accessories: SavedAccessory[]
  /** Device id currently being enrolled, so its row can show the handshake running. */
  enrolling: string | null
}

interface AccessoryActions {
  /** Reads native's current snapshot. Call on mount and on foreground restore. */
  sync: () => void
  enroll: (deviceId: string) => Promise<AccessoryEnrollment>
  forget: (accessoryId: string) => Promise<boolean>
}

/**
 * Mirrors native's enrolled Accessories.
 *
 * Nothing here is durable and nothing here is authoritative. Native owns the saved identities, the
 * radio, the protocol sessions and the connection phase; it keeps all of that running with this
 * store — and the whole JS runtime — dead. This is a render of the last snapshot it pushed, in
 * exactly the way `bleStore` mirrors a Board.
 *
 * So: no optimistic writes. A row does not go "connected" because the rider tapped something, and
 * enrolling adds nothing to this list — native answers with the accessory id it saved and then
 * pushes the state that proves it.
 */
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

/**
 * Subscribes the store to native's pushes, once per app run.
 *
 * Deliberately not tied to a screen: an Accessory's state changes while nothing is mounted, and the
 * Board selector must be able to open onto the truth rather than onto an empty list it then fills.
 *
 * Foreground is a second, necessary trigger. Native stops emitting to the bridge while the app is
 * backgrounded, so everything that happened to a link in the meantime — a reconnect, a drop, a
 * refused command — arrives as nothing at all. Coming back has to re-read rather than trust the
 * last push, exactly as `bleStore` does for a Board.
 */
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

/** One enrolled Accessory by identity, or undefined when it has been forgotten. */
export function useSavedAccessory(accessoryId: string): SavedAccessory | undefined {
  return useAccessoryStore((s) => s.accessories.find((a) => a.accessoryId === accessoryId))
}

/**
 * Whether this Accessory needs the rider's attention before anything it drives can be trusted.
 *
 * Two separate facts, both of which mean "do not act on saved settings": the app cannot drive it at
 * all, or the limits it declares moved since enrollment and a saved calibration may no longer fit.
 */
export function accessoryNeedsSetup(accessory: SavedAccessory): boolean {
  return accessory.capabilitiesChanged || accessory.compatibility === 'unsupported-capabilities'
}
