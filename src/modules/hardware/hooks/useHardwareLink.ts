import { useCallback, useEffect } from 'react'
import { Platform } from 'react-native'

import {
  addHardwareDeviceListener,
  addHardwareMessageListener,
  addHardwareSensorListener,
  addHardwareSeriesListener,
  addHardwareStateListener,
  getHardwareState,
  hardwareConnect,
  hardwareDisconnect,
  hardwareSend,
  hardwareStartScan,
  hardwareStopScan,
} from 'vescape-core'

import { applySensor, applySeries } from '@/modules/hardware/lib/sensorRuntime'
import { useHardwareStore } from '@/modules/hardware/store/hardwareStore'

/**
 * Whether an unprompted scan may connect to what it finds.
 *
 * There is one Vescape sensor module, so hunting for it by hand every time is ceremony. Pressing
 * Disconnect turns this off: the rider asked to be off the board, and a scan that reconnects a
 * second later would be fighting them. Pressing Scan asks for it again.
 */
let autoConnect = true

/**
 * Subscribes the Hardware Link mirror for as long as the caller is mounted, and returns the
 * commands. Android-only: on iOS every command is a no-op and the phase stays `idle`.
 *
 * Connects to the first `Vescape-HW` board it sees, unless the rider disconnected on purpose.
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
      addHardwareStateListener((event) => {
        useHardwareStore.getState().applyState(event)
        // A board that drops out — out of range, powered down — is found again on its own. A
        // deliberate disconnect cleared `autoConnect`, so this cannot fight the rider.
        if (autoConnect && (event.phase === 'idle' || event.phase === 'error')) hardwareStartScan()
      }),
      addHardwareDeviceListener((event) => {
        useHardwareStore.getState().addDevice(event)
        // First board seen wins. Native filters the scan by name, so anything reported here is
        // one; a second board is a case to solve when there is one to test against.
        if (autoConnect && useHardwareStore.getState().phase === 'scanning')
          hardwareConnect(event.id)
      }),
      // Console text only: native keeps sensor frames out of here, or fifty a second would
      // scroll away every reply the board sends within a frame of it arriving.
      addHardwareMessageListener((event) => {
        for (const message of event.messages)
          useHardwareStore
            .getState()
            .addLine({ text: message.text, atMs: message.atMs, direction: 'rx' })
      }),
      // Readings and charts, both already made by native. These write shared values and a
      // snapshot; neither goes through Zustand.
      addHardwareSensorListener(applySensor),
      addHardwareSeriesListener(applySeries),
    ]
    if (autoConnect && getHardwareState().phase === 'idle') {
      useHardwareStore.getState().clearDevices()
      hardwareStartScan()
    }
    return () => {
      for (const sub of subs) sub.remove()
      hardwareStopScan()
    }
  }, [])

  const scan = useCallback(() => {
    if (Platform.OS !== 'android') return
    autoConnect = true
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
    autoConnect = false
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
