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
    nativeStopScan()
    set({ scanning: false, devices: [] })
  },

  inspect: async (deviceId) => {
    if (get().inspecting) {
      return { deviceId, advertisedName: null, manifest: null, error: 'busy' }
    }
    set({ inspecting: deviceId })
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
  },
}))
