import { beforeEach, expect, mock, test } from 'bun:test'
import {
  ALERT_BEEP_COUNT_DEFAULT,
  type AlertRule,
  type BatteryConfig,
  type Board,
} from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const upsertBoard = mock(async (_board: Board) => {})
const upsertAlertRule = mock(async (_rule: AlertRule) => {})
const deleteAlertRule = mock(async (_boardId: string, _id: string) => {})
const getAlertRules = mock(async (_boardId: string) => [] as AlertRule[])

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  upsertBoard,
  upsertAlertRule,
  deleteAlertRule,
  getAlertRules,
}))

const BOARD_ID = 'board-1'
const VALID_BATTERY: BatteryConfig = { mode: 'manual', minVoltage: 40, maxVoltage: 50 }

function makeBoard(overrides?: {
  topSpeedKmh?: number
  batteryConfig?: BatteryConfig | null
}): Board {
  return {
    id: BOARD_ID,
    name: 'Board',
    description: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    // Honor an explicit `null` (invalid config) — `??` would swallow it back to the valid default.
    batteryConfig:
      overrides && 'batteryConfig' in overrides ? (overrides.batteryConfig ?? null) : VALID_BATTERY,
    topSpeedKmh: overrides?.topSpeedKmh ?? 40,
    alertPreset: null,
    alertPresetsOnboarded: false,
    link: null,
  }
}

async function setup(overrides?: {
  topSpeedKmh?: number
  batteryConfig?: BatteryConfig | null
  seedRules?: AlertRule[]
}) {
  const { useAlertsStore } = await import('@/modules/alerts/store/alertsStore')
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useAlertPresetStore } = await import('@/modules/alerts/store/alertPresetStore')

  // Alert Rules are Board-owned (#254); bind the alerts store to the board under test.
  useAlertsStore.setState({ boardId: BOARD_ID, rules: overrides?.seedRules ?? [] })
  useBoardStore.setState({
    boards: [makeBoard(overrides)],
    activeBoardId: BOARD_ID,
    updateBoard: useBoardStore.getInitialState().updateBoard,
  })

  return { useAlertsStore, useBoardStore, useAlertPresetStore }
}

const presetRules = (rules: AlertRule[], controlId: string) =>
  rules.filter((rule) => rule.source === 'preset' && rule.controlId === controlId)

const boardSelection = (board: Board | undefined) =>
  board?.alertPreset as Record<string, unknown> | null | undefined

beforeEach(() => {
  upsertBoard.mockClear()
  upsertAlertRule.mockClear()
  deleteAlertRule.mockClear()
  getAlertRules.mockClear()
})

test('setting a level persists the selection on the board and generates deterministically-ided preset rules', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('battery', 'normal')

  const board = useBoardStore.getState().boards.find((b) => b.id === BOARD_ID)
  expect(boardSelection(board)).toMatchObject({ battery: 'normal' })

  const rules = presetRules(useAlertsStore.getState().rules, 'battery')
  expect(rules.length).toBeGreaterThan(0)
  expect(rules.map((rule) => rule.id)).toEqual(rules.map((_, index) => `preset:battery:${index}`))
  for (const rule of rules) {
    expect(rule.source).toBe('preset')
    expect(rule.enabled).toBe(true)
    expect(rule.boardId).toBe(BOARD_ID)
  }
})

test('changing a level regenerates that metric wholesale', async () => {
  const { useAlertsStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('battery', 'safe')
  const safeCount = presetRules(useAlertsStore.getState().rules, 'battery').length

  await useAlertPresetStore.getState().setLevel('battery', 'minimal')
  const proRules = presetRules(useAlertsStore.getState().rules, 'battery')

  // safe declares more points than minimal, so regeneration must shrink the set, not append.
  expect(safeCount).toBeGreaterThan(proRules.length)
  expect(proRules.map((rule) => rule.id)).toEqual(
    proRules.map((_, index) => `preset:battery:${index}`),
  )
  expect(deleteAlertRule).toHaveBeenCalled()
})

test('off removes a metric preset rules entirely', async () => {
  const { useAlertsStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('battery', 'normal')
  expect(presetRules(useAlertsStore.getState().rules, 'battery').length).toBeGreaterThan(0)

  await useAlertPresetStore.getState().setLevel('battery', 'off')
  expect(presetRules(useAlertsStore.getState().rules, 'battery')).toHaveLength(0)
})

test('manual rules and other metrics survive a preset regeneration', async () => {
  const manual: AlertRule = {
    boardId: BOARD_ID,
    id: 'manual-1',
    controlId: 'battery',
    threshold: 33,
    thresholdMax: null,
    enabled: true,
    soundType: 'preset:beep',
    createdAt: 1,
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
    updatedAt: 1,
    source: 'manual',
  }
  const otherPreset: AlertRule = {
    boardId: BOARD_ID,
    id: 'preset:duty:0',
    controlId: 'duty',
    threshold: 70,
    thresholdMax: 90,
    enabled: true,
    soundType: 'preset:tick',
    createdAt: 1,
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
    updatedAt: 1,
    source: 'preset',
  }
  const { useAlertsStore, useAlertPresetStore } = await setup({ seedRules: [manual, otherPreset] })

  await useAlertPresetStore.getState().setLevel('battery', 'normal')

  const rules = useAlertsStore.getState().rules
  expect(rules.find((rule) => rule.id === 'manual-1')).toEqual(manual)
  expect(rules.find((rule) => rule.id === 'preset:duty:0')).toEqual(otherPreset)
})

test('changing Board Top Speed regenerates the speed preset thresholds', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup({ topSpeedKmh: 40 })

  await useAlertPresetStore.getState().setLevel('speed', 'normal')
  const at40 = presetRules(useAlertsStore.getState().rules, 'speed')[0]!

  const board = useBoardStore.getState().boards.find((b) => b.id === BOARD_ID)!
  useBoardStore.setState({ boards: [{ ...board, topSpeedKmh: 100 }] })
  await useAlertPresetStore.getState().regenerateSpeed()
  const at100 = presetRules(useAlertsStore.getState().rules, 'speed')[0]!

  expect(at100.threshold).toBeGreaterThan(at40.threshold)
  expect(at100.thresholdMax).toBe(90) // 0.9 * 100
})

test('battery preset generates nothing without a valid board battery config', async () => {
  const { useAlertsStore, useAlertPresetStore } = await setup({ batteryConfig: null })

  await useAlertPresetStore.getState().setLevel('battery', 'normal')

  expect(presetRules(useAlertsStore.getState().rules, 'battery')).toHaveLength(0)
})

test('editing an inactive board regenerates only that board rules', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup()
  const inactiveBoard = { ...makeBoard({ topSpeedKmh: 60 }), id: 'board-2', name: 'Other' }
  useBoardStore.setState((state) => ({ boards: [...state.boards, inactiveBoard] }))

  const staleRule: AlertRule = {
    boardId: inactiveBoard.id,
    id: 'preset:speed:0',
    controlId: 'speed',
    threshold: 30,
    thresholdMax: 40,
    enabled: true,
    soundType: 'preset:tick',
    createdAt: 1,
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
    updatedAt: 1,
    source: 'preset',
  }
  getAlertRules.mockImplementation(async (boardId: string) =>
    boardId === inactiveBoard.id ? [staleRule] : [],
  )

  await useAlertPresetStore.getState().setLevel('speed', 'normal', inactiveBoard.id)

  expect(useBoardStore.getState().activeBoardId).toBe(BOARD_ID)
  expect(
    boardSelection(useBoardStore.getState().boards.find((b) => b.id === inactiveBoard.id)),
  ).toMatchObject({ speed: 'normal' })
  expect(deleteAlertRule).toHaveBeenCalledWith(inactiveBoard.id, staleRule.id)
  expect(upsertAlertRule.mock.calls.every(([rule]) => rule.boardId === inactiveBoard.id)).toBe(true)
  expect(useAlertsStore.getState().boardId).toBe(BOARD_ID)
  expect(useAlertsStore.getState().rules).toHaveLength(0)
})

test('customize hands the level rules to the rider and stops regenerating the metric', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('battery', 'normal')
  const generated = presetRules(useAlertsStore.getState().rules, 'battery')

  await useAlertPresetStore.getState().customize('battery')

  const board = useBoardStore.getState().boards.find((b) => b.id === BOARD_ID)
  expect(boardSelection(board)).toMatchObject({ battery: 'custom' })

  const rules = useAlertsStore.getState().rules.filter((rule) => rule.controlId === 'battery')
  // Same alerts, now rider-owned: no preset provenance and no deterministic preset ids to be
  // overwritten by a later regeneration.
  expect(rules.map((rule) => rule.threshold)).toEqual(generated.map((rule) => rule.threshold))
  expect(rules.map((rule) => rule.soundType)).toEqual(generated.map((rule) => rule.soundType))
  expect(rules.every((rule) => rule.source == null)).toBe(true)
  expect(rules.some((rule) => rule.id.startsWith('preset:'))).toBe(false)

  await useAlertPresetStore.getState().regenerateAll()
  expect(useAlertsStore.getState().rules.filter((r) => r.controlId === 'battery')).toEqual(rules)
})

test('customize from off starts the rider with an empty set', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('duty', 'off')
  await useAlertPresetStore.getState().customize('duty')

  expect(boardSelection(useBoardStore.getState().boards[0])).toMatchObject({ duty: 'custom' })
  expect(useAlertsStore.getState().rules.filter((rule) => rule.controlId === 'duty')).toHaveLength(
    0,
  )
})

test('discarding custom rules clears them and returns the metric to a preset', async () => {
  const { useAlertsStore, useBoardStore, useAlertPresetStore } = await setup()

  await useAlertPresetStore.getState().setLevel('duty', 'safe')
  await useAlertPresetStore.getState().customize('duty')
  useAlertsStore.getState().add('duty', {
    threshold: 70,
    thresholdMax: null,
    soundType: 'preset:beep',
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
  })
  expect(useAlertsStore.getState().rules.filter((rule) => rule.controlId === 'duty').length).toBe(2)

  await useAlertPresetStore.getState().discardCustom('duty')

  const rules = useAlertsStore.getState().rules.filter((rule) => rule.controlId === 'duty')
  // Every rider rule goes, including ones added after customizing; what is left is generated.
  expect(boardSelection(useBoardStore.getState().boards[0])).toMatchObject({ duty: 'normal' })
  expect(rules.length).toBeGreaterThan(0)
  expect(rules.every((rule) => rule.source === 'preset')).toBe(true)
})
