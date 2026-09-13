import { create } from 'zustand'
import {
  addAccessoryDeviceListener,
  addAccessoryScanErrorListener,
  cancelAccessoryInspection as nativeCancelInspection,
  inspectAccessory as nativeInspect,
  startAccessoryScan as nativeStartScan,
  stopAccessoryScan as nativeStopScan,
  type AccessoryInspection,
  type AccessoryInspectionError,
  type AccessoryManifest,
} from 'vescape-core'

import type { AccessoryLinkStatus } from '@/modules/accessories/lib/accessoryStatus'

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

/**
 * An Accessory whose manifest this app has read.
 *
 * Session-scoped on purpose. Discovery answers "what is this thing", and nothing more: an
 * Accessory is only remembered across launches once the rider enrolls it, and enrollment is native
 * durable truth, not a JS store. This holds what the current session learned so the Board selector
 * and the accessory screen have something to render.
 */
export interface KnownAccessory {
  /** Persistent Accessory identity from the manifest, not the BLE handle. */
  accessoryId: string
  /** The BLE handle it answered on this session — platform-scoped and not durable. */
  deviceId: string
  manifest: AccessoryManifest
  inspectedAt: number
  /** Set when the last handshake with it failed, so the row can say it is not reachable. */
  lastError: AccessoryInspectionError | null
}

interface AccessoryDiscoveryState {
  scanning: boolean
  scanError: 'bluetooth-unavailable' | 'scan-failed' | null
  devices: DiscoveredAccessoryDevice[]
  accessories: KnownAccessory[]
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
 */
export const useAccessoryDiscoveryStore = create<
  AccessoryDiscoveryState & AccessoryDiscoveryActions
>((set, get) => ({
  scanning: false,
  scanError: null,
  devices: [],
  accessories: [],
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
    if (get().scanning) nativeStopScan()
    set({ scanning: false })
  },

  inspect: async (deviceId) => {
    set({ inspecting: deviceId })
    // Native stops the scan for the duration of a handshake; mirror that so the UI agrees.
    if (get().scanning) set({ scanning: false })
    try {
      const result = await nativeInspect(deviceId)
      set((state) => ({
        inspecting: null,
        accessories: mergeInspection(state.accessories, deviceId, result),
      }))
      return result
    } catch (error) {
      set({ inspecting: null })
      throw error
    }
  },

  cancelInspection: () => {
    nativeCancelInspection()
    set({ inspecting: null })
  },
}))

/**
 * Folds one handshake result into the known list. A successful read replaces the entry for that
 * Accessory identity — the same physical unit can come back on a different BLE handle, and the
 * manifest is what says which one it is. A failure only annotates an Accessory already known;
 * a device that never answered is not an Accessory yet.
 */
function mergeInspection(
  accessories: KnownAccessory[],
  deviceId: string,
  result: AccessoryInspection,
): KnownAccessory[] {
  if (result.manifest) {
    const entry: KnownAccessory = {
      accessoryId: result.manifest.accessoryId,
      deviceId,
      manifest: result.manifest,
      inspectedAt: Date.now(),
      lastError: null,
    }
    const index = accessories.findIndex((a) => a.accessoryId === entry.accessoryId)
    if (index === -1) return [...accessories, entry]
    const next = [...accessories]
    next[index] = entry
    return next
  }
  if (!result.error) return accessories
  const error = result.error
  return accessories.map((a) => (a.deviceId === deviceId ? { ...a, lastError: error } : a))
}

/** What the Accessory's row should say about its link, given whatever the scan is hearing. */
export function accessoryLinkStatus(
  accessory: KnownAccessory,
  devices: DiscoveredAccessoryDevice[],
): AccessoryLinkStatus {
  if (devices.some((d) => d.id === accessory.deviceId)) return 'advertising'
  return accessory.lastError ? 'unreachable' : 'idle'
}
