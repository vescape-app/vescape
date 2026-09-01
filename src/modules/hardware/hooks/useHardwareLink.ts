import { useCallback, useEffect } from 'react'
import { Platform } from 'react-native'

import {
  addHardwareDeviceListener,
  addHardwareMessageListener,
  addHardwareStateListener,
  getHardwareState,
  hardwareConnect,
  hardwareDisconnect,
  hardwareSend,
  hardwareStartScan,
  hardwareStopScan,
} from 'vescape-core'

import { parseSensorFrame } from '@/modules/hardware/lib/parseSensorFrame'
import { useHardwareStore } from '@/modules/hardware/store/hardwareStore'

/**
 * Subscribes the Hardware Link mirror for as long as the caller is mounted, and returns the
 * commands. Android-only: on iOS every command is a no-op and the phase stays `idle`.
 */
export function useHardwareLink(): {
  scan: () => void
  stopScan: () => void
  connect: (id: string) => void
  disconnect: () => void
  send: (text: string) => Promise<boolean>
} {
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const store = useHardwareStore.getState()
    store.applyState(getHardwareState())
    const subs = [
      addHardwareStateListener((event) => useHardwareStore.getState().applyState(event)),
      addHardwareDeviceListener((event) => useHardwareStore.getState().addDevice(event)),
      // Sensor frames arrive once a second. They go to the readings card, not the console, which
      // would otherwise scroll away every reply the board sends.
      addHardwareMessageListener((event) => {
        const state = useHardwareStore.getState()
        const frame = parseSensorFrame(event.text, event.atMs)
        if (frame) state.applyFrame(frame)
        else state.addLine({ text: event.text, atMs: event.atMs, direction: 'rx' })
      }),
    ]
    return () => {
      for (const sub of subs) sub.remove()
      hardwareStopScan()
    }
  }, [])

  const scan = useCallback(() => {
    if (Platform.OS !== 'android') return
    useHardwareStore.getState().clearDevices()
    hardwareStartScan()
  }, [])

  const stopScan = useCallback(() => {
    if (Platform.OS !== 'android') return
    hardwareStopScan()
  }, [])

  const connect = useCallback((id: string) => {
    if (Platform.OS !== 'android') return
    hardwareConnect(id)
  }, [])

  const disconnect = useCallback(() => {
    if (Platform.OS !== 'android') return
    hardwareDisconnect()
  }, [])

  // Echo the write into the console once the device acknowledges it. A refused write is otherwise
  // indistinguishable from a delivered one, which makes "nothing came back" impossible to diagnose.
  const send = useCallback(async (text: string) => {
    if (Platform.OS !== 'android') return false
    const result = await hardwareSend(text)
    useHardwareStore.getState().addLine({
      text: result.ok ? text : `${text} (${result.detail ?? 'write failed'})`,
      atMs: Date.now(),
      direction: result.ok ? 'tx' : 'error',
    })
    return result.ok
  }, [])

  return { scan, stopScan, connect, disconnect, send }
}
