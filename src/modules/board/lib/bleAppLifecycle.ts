import type { AppStateStatus } from 'react-native'
import type { ScanStatus } from 'vescape-core'

interface BleAppLifecycleActions {
  scanStatus: ScanStatus
  stopScan: () => void
  syncNativeState: () => void
}

export function handleBleAppStateChange(
  nextState: AppStateStatus,
  { scanStatus, stopScan, syncNativeState }: BleAppLifecycleActions,
): void {
  if (nextState === 'background') {
    if (scanStatus === 'scanning') stopScan()
    return
  }

  if (nextState === 'active') syncNativeState()
}
