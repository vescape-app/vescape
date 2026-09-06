import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { handleBleAppStateChange } from '@/modules/board/lib/bleAppLifecycle'
import { useBleStore } from '@/modules/board/store/bleStore'

export function useBleAppLifecycle(): void {
  const stopScan = useBleStore((s) => s.stopScan)
  const syncNativeState = useBleStore((s) => s.syncNativeState)

  useEffect(() => {
    syncNativeState()
    const onChange = (nextState: AppStateStatus) => {
      handleBleAppStateChange(nextState, {
        scanStatus: useBleStore.getState().scanStatus,
        stopScan,
        syncNativeState,
      })
    }

    const subscription = AppState.addEventListener('change', onChange)
    return () => subscription.remove()
  }, [stopScan, syncNativeState])
}
