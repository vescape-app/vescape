import { beforeEach, expect, mock, test } from 'bun:test'
import type { AlertRule, Board, AlertPresetIntent } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')
const applyAlertPreset = mock(
  async (_boardId: string, _metric: string, _intent: AlertPresetIntent) => {},
)
const upsertAlertRule = mock(async (_rule: AlertRule) => {})
const deleteAlertRule = mock(async (_boardId: string, _id: string) => {})
const getAlertRules = mock(async (_boardId: string) => [] as AlertRule[])
const getAlertPresets = mock(async (_boardId: string) => ({}))
mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  applyAlertPreset,
  upsertAlertRule,
  deleteAlertRule,
  getAlertRules,
  getAlertPresets,
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
  alertPresetsOnboarded: true,
  link: null,
}
async function setup(rules: AlertRule[] = []) {
  const { useAlertsStore } = await import('@/modules/alerts/store/alertsStore')
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useAlertPresetStore } = await import('@/modules/alerts/store/alertPresetStore')
  useAlertsStore.setState({ boardId: BOARD_ID, rules, presets: {}, error: null })
  useBoardStore.setState({ boards: [board], activeBoardId: BOARD_ID })
  return { useAlertsStore, useBoardStore, useAlertPresetStore }
}

beforeEach(async () => {
  applyAlertPreset.mockReset()
  applyAlertPreset.mockImplementation(async () => {})
  upsertAlertRule.mockReset()
  upsertAlertRule.mockImplementation(async () => {})
  deleteAlertRule.mockReset()
  deleteAlertRule.mockImplementation(async () => {})
  getAlertRules.mockReset()
  getAlertRules.mockImplementation(async () => [])
})

test('preset actions rewrite the row through one native intent and reload rules', async () => {
  const { useAlertPresetStore } = await setup()
  await useAlertPresetStore.getState().setLevel('speed', 'normal')
  await useAlertPresetStore.getState().setMatchBoardConfig('duty', true)
  await useAlertPresetStore.getState().setGeigerSound('speed', 'geiger:mid')
  expect(applyAlertPreset.mock.calls).toEqual([
    [BOARD_ID, 'speed', { level: 'normal' }],
    [BOARD_ID, 'duty', { match: true }],
    [BOARD_ID, 'speed', { geiger: 'mid' }],
  ])
  expect(getAlertRules).toHaveBeenCalledTimes(3)
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
  expect(useAlertPresetStore.getState().error).toBe('transaction failed')
  expect(useAlertsStore.getState().error).toBeNull()
  expect(getAlertRules).not.toHaveBeenCalled()
  expect(useAlertPresetStore.getState().syncing).toBe(false)
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
    }),
  ).rejects.toThrow('disk unavailable')
  expect(useAlertsStore.getState().rules).toEqual([])
  expect(useAlertsStore.getState().error).toBe('disk unavailable')
})

test('failed Alert Rule read remains distinct from an empty result', async () => {
  const { useAlertsStore } = await setup()
  getAlertRules.mockRejectedValueOnce(new Error('query failed'))

  await expect(useAlertsStore.getState().load(BOARD_ID)).rejects.toThrow('query failed')
  expect(useAlertsStore.getState().error).toBe('query failed')
})
