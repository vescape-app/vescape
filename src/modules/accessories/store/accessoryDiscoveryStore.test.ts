import { beforeEach, expect, mock, test } from 'bun:test'
import type { AccessoryInspection, AccessoryManifest } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

let inspection: AccessoryInspection

const inspectAccessory = mock(async () => inspection)
const startAccessoryScan = mock(() => {})
const stopAccessoryScan = mock(() => {})
const cancelAccessoryInspection = mock(() => {})
const addAccessoryDeviceListener = mock(() => ({ remove: () => {} }))
const addAccessoryScanErrorListener = mock(() => ({ remove: () => {} }))

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  inspectAccessory,
  startAccessoryScan,
  stopAccessoryScan,
  cancelAccessoryInspection,
  addAccessoryDeviceListener,
  addAccessoryScanErrorListener,
}))

function manifest(overrides: Partial<AccessoryManifest> = {}): AccessoryManifest {
  return {
    accessoryId: 'acc-1',
    name: 'Clearance sensor',
    firmwareVersion: '0.1.0',
    protocolVersion: 1,
    supportedVersions: [],
    compatibility: 'supported',
    capabilities: [
      {
        id: 'clearance',
        type: 'ground_clearance',
        supported: true,
        unit: 'cm',
        rangeMin: 3,
        rangeMax: 100,
        ratesHz: [10, 20],
      },
    ],
    ...overrides,
  }
}

beforeEach(async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')
  useAccessoryDiscoveryStore.setState({
    scanning: false,
    scanError: null,
    devices: [],
    accessories: [],
    inspecting: null,
  })
})

test('an accessory is keyed on its manifest identity, not the BLE handle it answered on', async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  inspection = {
    deviceId: 'AA:01',
    advertisedName: 'Vescape-HW',
    manifest: manifest(),
    error: null,
  }
  await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  // Same unit, new address — an Android MAC can rotate and an iOS peripheral id is per-device.
  inspection = {
    deviceId: 'BB:02',
    advertisedName: 'Vescape-HW',
    manifest: manifest({ firmwareVersion: '0.2.0' }),
    error: null,
  }
  await useAccessoryDiscoveryStore.getState().inspect('BB:02')

  const { accessories } = useAccessoryDiscoveryStore.getState()
  expect(accessories).toHaveLength(1)
  expect(accessories[0]!.deviceId).toBe('BB:02')
  expect(accessories[0]!.manifest.firmwareVersion).toBe('0.2.0')
})

test('a device that never answered with a manifest is not remembered as an accessory', async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  inspection = { deviceId: 'AA:01', advertisedName: null, manifest: null, error: 'timeout' }
  await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  expect(useAccessoryDiscoveryStore.getState().accessories).toEqual([])
  expect(useAccessoryDiscoveryStore.getState().inspecting).toBeNull()
})

test('a failed re-check marks a known accessory unreachable instead of dropping it', async () => {
  const { accessoryLinkStatus, useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  inspection = { deviceId: 'AA:01', advertisedName: null, manifest: manifest(), error: null }
  await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  inspection = { deviceId: 'AA:01', advertisedName: null, manifest: null, error: 'connect-failed' }
  await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  const accessory = useAccessoryDiscoveryStore.getState().accessories[0]!
  expect(accessory.lastError).toBe('connect-failed')
  expect(accessoryLinkStatus(accessory, [])).toBe('unreachable')
  // Still advertising and still refusing to answer is exactly the case the rider needs told: the
  // failed handshake is the useful fact, not the radio carrier.
  expect(
    accessoryLinkStatus(accessory, [
      { id: 'AA:01', name: null, rssi: -50, lastSeenAt: Date.now() },
    ]),
  ).toBe('unreachable')
})

test('a second selection is refused while a handshake is running', async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  let release: (() => void) | null = null
  inspectAccessory.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { deviceId: 'AA:01', advertisedName: null, manifest: manifest(), error: null }
  })

  const first = useAccessoryDiscoveryStore.getState().inspect('AA:01')
  const second = await useAccessoryDiscoveryStore.getState().inspect('BB:02')

  expect(second.error).toBe('busy')
  // The refused tap must not take `inspecting` away from the handshake that is still running.
  expect(useAccessoryDiscoveryStore.getState().inspecting).toBe('AA:01')

  release!()
  await first
  expect(useAccessoryDiscoveryStore.getState().inspecting).toBeNull()
})
