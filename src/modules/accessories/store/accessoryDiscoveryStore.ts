import { create } from 'zustand'
import {
  addAccessoryDeviceListener,
  addAccessoryScanErrorListener,
  cancelAccessoryInspection as nativeCancelInspection,
  inspectAccessory as nativeInspect,
  startAccessoryScan as nativeStartScan,
  stopAccessoryScan as nativeStopScan,
  type AccessoryInspection,
} from 'vescape-core'

interface EventSubscription {
  remove(): void
}

/** One advertisement seen by the running scan. */
export interface DiscoveredAccessoryDevice {
  id: string
  name: string | null
  rssi: number
  lastSeenAt: number
}

interface AccessoryDiscoveryState {
  scanning: boolean
  scanError: 'bluetooth-unavailable' | 'scan-failed' | null
  devices: DiscoveredAccessoryDevice[]
  /** Device id currently being inspected, so its row can show the handshake running. */
  inspecting: string | null
}

interface AccessoryDiscoveryActions {
  startScan: () => void
  stopScan: () => void
  inspect: (deviceId: string) => Promise<AccessoryInspection>
  cancelInspection: () => void
}

let deviceSub: EventSubscription | null = null
let errorSub: EventSubscription | null = null

/**
 * Mirrors native accessory discovery. Native owns the radio, the NDJSON framing, the protocol
 * session and the compatibility verdict; this store renders what it reports and sends intents back.
 *
 * Scan-scoped and nothing more. What an Accessory *is* — saved, connected, driving anything — lives
 * in `accessoryStore`, mirroring native's durable enrollment. Finding hardware and remembering it
 * are separate acts, and this store only knows about the first.
 */
export const useAccessoryDiscoveryStore = create<
  AccessoryDiscoveryState & AccessoryDiscoveryActions
>((set, get) => ({
  scanning: false,
  scanError: null,
  devices: [],
  inspecting: null,

  startScan: () => {
    if (get().scanning) return
    deviceSub?.remove()
    errorSub?.remove()
    deviceSub = addAccessoryDeviceListener((event) => {
      set((state) => {
        const next: DiscoveredAccessoryDevice = {
          id: event.id,
          name: event.name,
          rssi: event.rssi,
          lastSeenAt: Date.now(),
        }
        const index = state.devices.findIndex((d) => d.id === event.id)
        if (index === -1) return { devices: [...state.devices, next] }
        const devices = [...state.devices]
        devices[index] = next
        return { devices }
      })
    })
    errorSub = addAccessoryScanErrorListener(({ error }) => {
      set({ scanError: error, scanning: false })
    })
    set({ scanning: true, scanError: null, devices: [] })
    nativeStartScan()
  },

  stopScan: () => {
    deviceSub?.remove()
    deviceSub = null
    errorSub?.remove()
    errorSub = null
    // Unconditional: a scan that failed natively already cleared this store's `scanning` flag, and
    // gating the stop on it left the native scan intent armed — on iOS that resumed a listener-less
    // scan as soon as Bluetooth came back.
    nativeStopScan()
    // Sightings belong to the scan that gathered them. Keeping them would leave every accessory
    // reading "Nearby" indefinitely, which is the one thing the row's status must not lie about.
    set({ scanning: false, devices: [] })
  },

  inspect: async (deviceId) => {
    // One handshake at a time, decided here as well as natively: a second tap would otherwise take
    // back `inspecting` from the running one, hiding its spinner and letting its result arrive
    // after the rider already moved on.
    if (get().inspecting) {
      return { deviceId, advertisedName: null, manifest: null, error: 'busy' }
    }
    set({ inspecting: deviceId })
    // Native stops the scan for the duration of a handshake; mirror that so the UI agrees.
    if (get().scanning) set({ scanning: false })
    try {
      return await nativeInspect(deviceId)
    } finally {
      set((state) => ({
        inspecting: state.inspecting === deviceId ? null : state.inspecting,
      }))
    }
  },

  cancelInspection: () => {
    nativeCancelInspection()
    // `inspecting` is left to the in-flight `inspect` call to clear when native answers with
    // `cancelled`, so the two writers cannot disagree about which handshake is running.
  },
}))
