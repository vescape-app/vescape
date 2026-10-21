import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  ALERT_BEEP_COUNT_DEFAULT,
  type AlertRule,
  type Board,
  type AlertPresetIntent,
} from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')
const applyAlertPreset = mock(
  async (_boardId: string, _metric: string, _intent: AlertPresetIntent) => {},
)
const upsertAlertRule = mock(async (_rule: AlertRule) => {})
const getAlertRules = mock(async (_boardId: string) => [] as AlertRule[])
mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  applyAlertPreset,
  upsertAlertRule,
  getAlertRules,
}))

const BOARD_ID = 'board-1'
const board: Board = {
  id: BOARD_ID,
  name: 'Board',
  description: null,
  createdAt: 1,
  deletedAt: null,
  batteryConfig: { mode: 'manual', minVoltage: 40, maxVoltage: 50 },
  topSpeedKmh: 50,
  alertPreset: { speed: 'safe' },
  alertPresetsOnboarded: true,
  link: null,
}
const boardLoad = mock(async () => {})
let restore = () => {}

async function setup(_options?: { seedRules: AlertRule[] }) {
  const { useAlertsStore } = await import('@/modules/alerts/store/alertsStore')
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useAlertPresetStore } = await import('@/modules/alerts/store/alertPresetStore')
  useAlertsStore.setState({ boardId: BOARD_ID, rules: [], error: null })
  useBoardStore.setState({ boards: [board], activeBoardId: BOARD_ID })
  return { useAlertsStore, useBoardStore, useAlertPresetStore }
}

beforeEach(async () => {
  applyAlertPreset.mockReset()
  applyAlertPreset.mockImplementation(async () => {})
  upsertAlertRule.mockReset()
  upsertAlertRule.mockImplementation(async () => {})
  getAlertRules.mockReset()
  getAlertRules.mockImplementation(async () => [])
  boardLoad.mockReset()
  boardLoad.mockImplementation(async () => {})
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const oldLoad = useBoardStore.getState().load
  useBoardStore.setState({ load: boardLoad })
  restore = () => useBoardStore.setState({ load: oldLoad })
})
afterEach(() => restore())

test('preset actions send one native intent and reload committed state without JS rule writes', async () => {
  const { useAlertPresetStore } = await setup()
  await useAlertPresetStore.getState().setLevel('speed', 'normal')
  await useAlertPresetStore.getState().customize('duty')
  await useAlertPresetStore.getState().discardCustom('motor-temp')
  await useAlertPresetStore.getState().setMatchBoardConfig('duty', true)
  expect(applyAlertPreset.mock.calls).toEqual([
    [BOARD_ID, 'speed', { action: 'select', level: 'normal' }],
    [BOARD_ID, 'duty', { action: 'customize' }],
    [BOARD_ID, 'motor-temp', { action: 'discard-custom' }],
    [BOARD_ID, 'duty', { action: 'match-board-config', enabled: true }],
  ])
  expect(boardLoad).toHaveBeenCalledTimes(4)
  expect(getAlertRules).toHaveBeenCalledTimes(4)
  expect(upsertAlertRule).not.toHaveBeenCalled()
})

test('failed native switch leaves the rendered selection and rules intact and reports the error', async () => {
  const { useAlertPresetStore, useBoardStore, useAlertsStore } = await setup()
  const beforeRules = useAlertsStore.getState().rules
  applyAlertPreset.mockRejectedValueOnce(new Error('transaction failed'))
  await expect(useAlertPresetStore.getState().setLevel('speed', 'normal')).rejects.toThrow(
    'transaction failed',
  )
  expect(useBoardStore.getState().boards).toEqual([board])
  expect(useAlertsStore.getState().rules).toBe(beforeRules)
  expect(useAlertsStore.getState().error).toBe('transaction failed')
  expect(boardLoad).not.toHaveBeenCalled()
  expect(getAlertRules).not.toHaveBeenCalled()
  expect(useAlertPresetStore.getState().syncing).toBe(false)
})

test('switching an inactive Board does not replace the active Board rules', async () => {
  const { useAlertPresetStore } = await setup()
  await useAlertPresetStore.getState().setLevel('speed', 'normal', 'other-board')
  expect(applyAlertPreset).toHaveBeenCalledWith('other-board', 'speed', {
    action: 'select',
    level: 'normal',
  })
  expect(boardLoad).toHaveBeenCalledTimes(1)
  expect(getAlertRules).not.toHaveBeenCalled()
})

test('a read failure after commit is reported without inventing local rules', async () => {
  const { useAlertPresetStore, useAlertsStore } = await setup()
  getAlertRules.mockRejectedValueOnce(new Error('query failed'))
  await expect(useAlertPresetStore.getState().setLevel('speed', 'normal')).rejects.toThrow(
    'query failed',
  )
  expect(useAlertsStore.getState().rules).toEqual([])
  expect(useAlertsStore.getState().error).toBe('query failed')
})

test('failed Alert Rule save does not publish optimistic state', async () => {
  const { useAlertsStore } = await setup()
  upsertAlertRule.mockRejectedValueOnce(new Error('disk unavailable'))

  await expect(
    useAlertsStore.getState().add('duty', {
      threshold: 70,
      thresholdMax: null,
      soundType: 'preset:beep',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    }),
  ).rejects.toThrow('disk unavailable')
  expect(useAlertsStore.getState().rules).toEqual([])
  expect(useAlertsStore.getState().error).toBe('disk unavailable')
})

test('failed Alert Rule read remains distinct from an empty result', async () => {
  const { useAlertsStore } = await setup({ seedRules: [] })
  getAlertRules.mockRejectedValueOnce(new Error('query failed'))

  await expect(useAlertsStore.getState().load(BOARD_ID)).rejects.toThrow('query failed')
  expect(useAlertsStore.getState().error).toBe('query failed')
})
