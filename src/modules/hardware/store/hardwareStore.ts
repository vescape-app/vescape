import { create } from 'zustand'

import type { HardwareDeviceEvent, HardwarePhase, HardwareStateEvent } from 'vescape-core'

import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** Lines kept from the device. Old ones fall off the end; this is a debug console, not a log. */
const MAX_LINES = 200

/** Frames kept for the charts. One a second, so this is the last few minutes. */
const MAX_FRAMES = 300

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
  /** Sensor frames from the board, oldest first. Empty until the first one arrives. */
  frames: SensorFrame[]
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
  frames: [],
  applyState: (state) =>
    set((prev) => ({
      phase: state.phase,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      error: state.error,
      // Readings belong to a live link. Keeping them past a drop shows a stale temperature as
      // if the board were still reporting it.
      frames: state.phase === 'connected' ? prev.frames : [],
    })),
  addDevice: (device) =>
    set((prev) => {
      const rest = prev.devices.filter((d) => d.id !== device.id)
      return { devices: [...rest, device].sort((a, b) => b.rssi - a.rssi) }
    }),
  clearDevices: () => set({ devices: [] }),
  addLine: (line) => set((prev) => ({ lines: [line, ...prev.lines].slice(0, MAX_LINES) })),
  clearLines: () => set({ lines: [] }),
  applyFrame: (frame) => set((prev) => ({ frames: [...prev.frames, frame].slice(-MAX_FRAMES) })),
}))
