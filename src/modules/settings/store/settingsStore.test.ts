import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings, CompanionPresenceBoard } from 'vescape-core'

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
  themeMode: 'system',
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
  vescFaultCollectionEnabled: true,
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
let companionBoards: CompanionPresenceBoard[] = []
const getSettings = mock(async () => settings)
const getCompanionPresenceBoards = mock(async () => companionBoards)
const addCompanionPresenceBoard = mock(async () => undefined)
const removeCompanionPresenceBoard = mock(async () => undefined)
const updateSetting = mock(async () => undefined)
const setCompanionPresenceEnabled = mock(async () => undefined)

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  getSettings,
  getCompanionPresenceBoards,
  addCompanionPresenceBoard,
  removeCompanionPresenceBoard,
  updateSetting,
  setCompanionPresenceEnabled,
}))
mock.module('../../modules/vescape-core/src/index', () => ({
  ...actualVescapeCore,
  getSettings,
  getCompanionPresenceBoards,
  addCompanionPresenceBoard,
  removeCompanionPresenceBoard,
  updateSetting,
  setCompanionPresenceEnabled,
}))

beforeEach(async () => {
  settings = { ...BASE, historyMetricHotRanges: { battery: { start: 0, end: 1 } } }
  companionBoards = []
  getSettings.mockClear()
  updateSetting.mockClear()
  setCompanionPresenceEnabled.mockClear()
  getCompanionPresenceBoards.mockClear()
  addCompanionPresenceBoard.mockClear()
  removeCompanionPresenceBoard.mockClear()
  ;(globalThis as { __vescBleStoreCleanup?: () => void }).__vescBleStoreCleanup?.()
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  useSettingsStore.setState({
    loaded: false,
    loadError: null,
    writeError: null,
    companionPresenceBoards: [],
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

test('failed settings read does not mark defaults as loaded', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  getSettings.mockRejectedValueOnce(new Error('storage unavailable'))

  await useSettingsStore.getState().load()

  expect(useSettingsStore.getState().loaded).toBe(false)
  expect(useSettingsStore.getState().loadError).toBe(
    'Settings could not be read. Restart Vescape before changing settings.',
  )
  await expect(useSettingsStore.getState().set('themeMode', 'dark')).rejects.toThrow(
    'Settings are unavailable',
  )
  await expect(useSettingsStore.getState().addCompanionBoard('board-a')).rejects.toThrow(
    'Settings are unavailable',
  )
  expect(updateSetting).not.toHaveBeenCalled()
  expect(addCompanionPresenceBoard).not.toHaveBeenCalled()
})

test('failed settings write stays rejected and exposes a visible error', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  await useSettingsStore.getState().load()
  updateSetting.mockRejectedValueOnce(new Error('disk failed'))

  await expect(useSettingsStore.getState().set('themeMode', 'dark')).rejects.toThrow('disk failed')

  expect(useSettingsStore.getState().themeMode).not.toBe('dark')
  expect(useSettingsStore.getState().writeError).toBe('Setting could not be saved. Try again.')
})

test('failed reload revokes mutation access while preserving loaded values', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  await useSettingsStore.getState().load()
  const loadedTheme = useSettingsStore.getState().themeMode
  getSettings.mockRejectedValueOnce(new Error('storage unavailable'))

  await useSettingsStore.getState().load()

  expect(useSettingsStore.getState().loaded).toBe(false)
  expect(useSettingsStore.getState().themeMode).toBe(loadedTheme)
  await expect(useSettingsStore.getState().setCompanionPresence(true)).rejects.toThrow(
    'Settings are unavailable',
  )
  await expect(useSettingsStore.getState().removeCompanionBoard('board-a')).rejects.toThrow(
    'Settings are unavailable',
  )
  expect(setCompanionPresenceEnabled).not.toHaveBeenCalled()
  expect(removeCompanionPresenceBoard).not.toHaveBeenCalled()
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

test('adding and removing auto-start boards reloads native association membership', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  const board = { boardId: 'board-a', name: 'Thor', bleId: 'AA:BB' }
  await useSettingsStore.getState().load()

  companionBoards = [board]
  await useSettingsStore.getState().addCompanionBoard(board.boardId)
  expect(addCompanionPresenceBoard).toHaveBeenCalledWith(board.boardId)
  expect(useSettingsStore.getState().companionPresenceBoards).toEqual([board])
  expect(useSettingsStore.getState().companionPresenceEnabled).toBe(true)

  companionBoards = []
  await useSettingsStore.getState().removeCompanionBoard(board.boardId)
  expect(removeCompanionPresenceBoard).toHaveBeenCalledWith(board.boardId)
  expect(useSettingsStore.getState().companionPresenceBoards).toEqual([])
  expect(useSettingsStore.getState().companionPresenceEnabled).toBe(true)
})

test('master auto-start switch is independent from configured boards', async () => {
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  const board = { boardId: 'board-a', name: 'Thor', bleId: 'AA:BB' }
  await useSettingsStore.getState().load()
  companionBoards = [board]

  await useSettingsStore.getState().setCompanionPresence(true)
  expect(setCompanionPresenceEnabled).toHaveBeenCalledWith(true)
  expect(useSettingsStore.getState().companionPresenceEnabled).toBe(true)
  expect(useSettingsStore.getState().companionPresenceBoards).toEqual([board])

  companionBoards = []
  await useSettingsStore.getState().setCompanionPresence(false)
  expect(setCompanionPresenceEnabled).toHaveBeenCalledWith(false)
  expect(useSettingsStore.getState().companionPresenceEnabled).toBe(false)
  expect(useSettingsStore.getState().companionPresenceBoards).toEqual([])
})
