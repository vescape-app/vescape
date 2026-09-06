import { expect, mock, test } from 'bun:test'

import { handleBleAppStateChange } from '@/modules/board/lib/bleAppLifecycle'

test('temporary iOS inactivity preserves an active BLE scan', () => {
  const stopScan = mock(() => {})
  const syncNativeState = mock(() => {})

  handleBleAppStateChange('inactive', {
    scanStatus: 'scanning',
    stopScan,
    syncNativeState,
  })
  handleBleAppStateChange('active', {
    scanStatus: 'scanning',
    stopScan,
    syncNativeState,
  })

  expect(stopScan).not.toHaveBeenCalled()
  expect(syncNativeState).toHaveBeenCalledTimes(1)
})

test('backgrounding stops an active BLE scan', () => {
  const stopScan = mock(() => {})

  handleBleAppStateChange('background', {
    scanStatus: 'scanning',
    stopScan,
    syncNativeState: () => {},
  })

  expect(stopScan).toHaveBeenCalledTimes(1)
})
