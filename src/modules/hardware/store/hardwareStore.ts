import { create } from 'zustand'

import type { HardwareDeviceEvent, HardwarePhase, HardwareStateEvent } from 'vescape-core'

import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** Lines kept from the device. Old ones fall off the end; this is a debug console, not a log. */
const MAX_LINES = 200

export interface HardwareLine {
  text: string
  atMs: number
  /** `rx` came from the device, `tx` is what we wrote, `error` is a write the link refused. */
  direction: 'rx' | 'tx' | 'error'
}

interface HardwareState {
  phase: HardwarePhase
  deviceId: string | null
  deviceName: string | null
  error: string | null
  /** Devices seen in the current scan, newest RSSI wins, keyed by address. */
  devices: HardwareDeviceEvent[]
  lines: HardwareLine[]
  /** Latest sensor frame from the board, or null while nothing has arrived on this link. */
  frame: SensorFrame | null
  applyState: (state: HardwareStateEvent) => void
  addDevice: (device: HardwareDeviceEvent) => void
  clearDevices: () => void
  addLine: (line: HardwareLine) => void
  applyFrame: (frame: SensorFrame) => void
  clearLines: () => void
}

/**
 * JS mirror of the native Hardware Link (Android only). Native owns the connection; this store only
 * projects phase, the scan result list, and the received lines.
 */
export const useHardwareStore = create<HardwareState>((set) => ({
  phase: 'idle',
  deviceId: null,
  deviceName: null,
  error: null,
  devices: [],
  lines: [],
  frame: null,
  applyState: (state) =>
    set((prev) => ({
      phase: state.phase,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      error: state.error,
      // Readings belong to a live link. Keeping them past a drop shows a stale temperature as
      // if the board were still reporting it.
      frame: state.phase === 'connected' ? prev.frame : null,
    })),
  addDevice: (device) =>
    set((prev) => {
      const rest = prev.devices.filter((d) => d.id !== device.id)
      return { devices: [...rest, device].sort((a, b) => b.rssi - a.rssi) }
    }),
  clearDevices: () => set({ devices: [] }),
  addLine: (line) => set((prev) => ({ lines: [line, ...prev.lines].slice(0, MAX_LINES) })),
  clearLines: () => set({ lines: [] }),
  applyFrame: (frame) => set({ frame }),
}))
