import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const BASE: AppSettings = {
  liveHistoryLimit: 5,
  autoConnect: true,
  autoRecording: false,
  selectedBoardId: null,
  lastGpsLatitude: null,
  lastGpsLongitude: null,
  directionPointLatitude: null,
  directionPointLongitude: null,
  movingSpeedThresholdKmh: 3,
  rideSplitGapMinutes: 30,
  freeSpinMaxSpeedDeltaKmh: 12,
  freeSpinStationaryBoardCapKmh: 15,
  mapStyleKey: 'onedark',
  satelliteOverlayEnabled: true,
  satelliteImageryOpacity: 0.2,
  satelliteMapImageryOpacity: 1,
  satelliteImagerySaturation: -0.35,
  hideTelemetryMapDetails: true,
  mapOrientationMode: 'northUp',
  historyMetricGradientsEnabled: true,
  historyMetricHotRanges: { battery: { start: 0, end: 1 } },
  socEstimateWindowSeconds: 20,
  boardMoveStrengthPercent: 60,
  connectionSoundsEnabled: true,
  companionPresenceEnabled: false,
  boardWarningsEnabled: true,
  companionPresenceCooldownMinutes: 60,
  autoCloseEnabled: false,
  autoCloseDelayMinutes: 15,
  telemetryPollRateHz: 20,
  wearPushRateHz: 4,
  wearAutoLaunchOnConnect: true,
  wearNavArrowEnabled: false,
  riderId: null,
  riderName: null,
  riderColor: null,
  legalPolicy: null,
  dismissedCommunityMessageIds: [],
}

let settings: AppSettings = BASE
const getSettings = mock(async () => settings)
const updateSetting = mock(async () => undefined)
const setCompanionPresenceEnabled = mock(async () => undefined)

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  getSettings,
  updateSetting,
  setCompanionPresenceEnabled,
}))
mock.module('../../modules/vescape-core/src/index', () => ({
  ...actualVescapeCore,
  getSettings,
  updateSetting,
  setCompanionPresenceEnabled,
}))

beforeEach(async () => {
  settings = { ...BASE, historyMetricHotRanges: { battery: { start: 0, end: 1 } } }
  getSettings.mockClear()
  updateSetting.mockClear()
  setCompanionPresenceEnabled.mockClear()
  ;(globalThis as { __vescBleStoreCleanup?: () => void }).__vescBleStoreCleanup?.()
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  useSettingsStore.setState({
    loaded: false,
    load: useSettingsStore.getInitialState().load,
  })
})

test('reloading identical settings notifies no subscribers and keeps object refs', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  await useSettingsStore.getState().load()

  const hotRangesRef = useSettingsStore.getState().historyMetricHotRanges
  let notifications = 0
  const unsub = useSettingsStore.subscribe(() => notifications++)

  await useSettingsStore.getState().load()
  unsub()

  expect(notifications).toBe(0)
  expect(useSettingsStore.getState().historyMetricHotRanges).toBe(hotRangesRef)
})

test('reload applies only the keys that actually changed', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  await useSettingsStore.getState().load()

  const hotRangesRef = useSettingsStore.getState().historyMetricHotRanges
  const nextLiveHistoryLimit = useSettingsStore.getState().liveHistoryLimit + 4
  settings = { ...settings, liveHistoryLimit: nextLiveHistoryLimit }

  const changed: string[] = []
  const unsub = useSettingsStore.subscribe((next, prev) => {
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] !== prev[key]) changed.push(key)
    }
  })
  await useSettingsStore.getState().load()
  unsub()

  expect(changed).toEqual(['liveHistoryLimit'])
  expect(useSettingsStore.getState().liveHistoryLimit).toBe(nextLiveHistoryLimit)
  // Untouched object field keeps identity, so its consumers don't re-render.
  expect(useSettingsStore.getState().historyMetricHotRanges).toBe(hotRangesRef)
})

test('companionPresenceEnabled forces autoConnect on load', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  settings = { ...settings, companionPresenceEnabled: true, autoConnect: false }
  await useSettingsStore.getState().load()

  expect(useSettingsStore.getState().autoConnect).toBe(true)
})
