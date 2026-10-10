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
    inspecting: null,
  })
})

test('inspecting a device remembers nothing — only enrollment does', async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  inspection = {
    deviceId: 'AA:01',
    advertisedName: 'Vescape-HW',
    manifest: manifest(),
    error: null,
  }
  const result = await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  // The manifest is the answer to "what is this", handed straight back to the screen. Anything
  // durable is native's, reached through `enrollAccessory`, and never inferred from a scan.
  expect(result.manifest?.accessoryId).toBe('acc-1')
  expect(useAccessoryDiscoveryStore.getState()).not.toHaveProperty('accessories')
  expect(useAccessoryDiscoveryStore.getState().inspecting).toBeNull()
})

test('a device that never answered clears the running handshake', async () => {
  const { useAccessoryDiscoveryStore } =
    await import('@/modules/accessories/store/accessoryDiscoveryStore')

  inspection = { deviceId: 'AA:01', advertisedName: null, manifest: null, error: 'timeout' }
  const result = await useAccessoryDiscoveryStore.getState().inspect('AA:01')

  expect(result.error).toBe('timeout')
  expect(useAccessoryDiscoveryStore.getState().inspecting).toBeNull()
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
