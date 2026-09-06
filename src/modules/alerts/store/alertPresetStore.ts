import { create } from 'zustand'
import { deleteAlertRule, getAlertRules, type AlertRule, type Board } from 'vescape-core'

import {
  ALERT_PRESET_FALLBACK_LEVEL,
  ALERT_PRESET_METRICS,
  ALERT_PRESET_SOURCE,
  resolvedAlertPresetRules,
  isPresetAlertRule,
  presetAlertRuleId,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { readBoardConfigBases } from '@/modules/alerts/lib/boardConfigBases'
import { materializePresetRules } from '@/modules/alerts/lib/customAlertRules'
import {
  boardAlertPresetSelection,
  boardHasBatteryConfig,
  boardMatchBoardConfig,
  boardTopSpeedKmh,
} from '@/modules/alerts/lib/boardAlertSettings'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

interface AlertPresetState {
  syncing: boolean
}

interface AlertPresetActions {
  /** Persist a metric's level, then regenerate that Board's preset rules. Defaults to active. */
  setLevel(metric: AlertPresetMetric, level: AlertPresetLevel, boardId?: string): Promise<void>
  /**
   * Hand a metric's rules to the rider: copy what its current level generates into ordinary
   * rules, then switch the metric to `custom` so nothing regenerates over them again.
   */
  customize(metric: AlertPresetMetric, boardId?: string): Promise<void>
  /** Drop every rider-owned rule for a metric and return it to a generated level. */
  discardCustom(metric: AlertPresetMetric, boardId?: string): Promise<void>
  /** Regenerate one metric's preset rules from persisted selection. Defaults to active Board. */
  regenerate(metric: AlertPresetMetric, boardId?: string): Promise<void>
  /** Rebuild the speed preset after Board Top Speed changes. */
  regenerateSpeed(boardId?: string): Promise<void>
  /** Regenerate every metric's preset rules for a Board (used after add-board setup). */
  regenerateAll(boardId?: string): Promise<void>
  /** Opt one metric's preset in or out of following the board's own configuration. */
  setMatchBoardConfig(metric: AlertPresetMetric, enabled: boolean, boardId?: string): Promise<void>
}

// Serialize rule churn so an interleaved Board Top Speed change, level change or customize can't
// race the delete-then-upsert and leave a metric's rules half-written.
let syncQueue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = syncQueue.then(task)
  syncQueue = run.catch(() => undefined)
  return run
}

export const useAlertPresetStore = create<AlertPresetState & AlertPresetActions>((set, get) => ({
  syncing: false,

  async setLevel(metric, level, boardId) {
    const board = targetBoard(boardId)
    if (!board) return
    await persistLevel(board, metric, level)
    await get().regenerate(metric, board.id)
  },

  async customize(metric, boardId) {
    const board = targetBoard(boardId)
    if (!board) return
    // Expand the outgoing level before overwriting it — that expansion *is* the rider's set.
    // Matched rules included: taking ownership must not silently move a threshold, so the outgoing
    // level expands under the same options regeneration used, config match and all.
    const seed = materializePresetRules(metric, boardAlertPresetSelection(board)[metric], {
      boardTopSpeedKmh: boardTopSpeedKmh(board),
      hasBatteryConfig: boardHasBatteryConfig(board),
      matchBoardConfig: boardMatchBoardConfig(board),
      configBases: readBoardConfigBases(),
    })
    // Level first: a crash after this leaves stale preset rules a retry cleans up, whereas the
    // reverse order would leave the metric silent while its level still claims a preset.
    await persistLevel(board, metric, 'custom')
    await enqueue(async () => {
      await regenerateMetric(board.id, metric, set)
      for (const rule of seed) {
        await useAlertsStore.getState().upsert({ ...rule, boardId: board.id })
      }
    })
  },

  async discardCustom(metric, boardId) {
    const board = targetBoard(boardId)
    if (!board) return
    // Rules first: regenerating into a metric that still holds rider rules would show both sets.
    await enqueue(async () => {
      await deleteRulesWhere(
        board.id,
        (rule) => rule.controlId === metric && !isPresetAlertRule(rule),
      )
    })
    await get().setLevel(metric, ALERT_PRESET_FALLBACK_LEVEL, board.id)
  },

  async regenerate(metric, boardId) {
    const targetId = targetBoard(boardId)?.id
    if (!targetId) return
    await enqueue(() => regenerateMetric(targetId, metric, set))
  },

  async regenerateSpeed(boardId) {
    await get().regenerate('speed', boardId)
  },

  async regenerateAll(boardId) {
    for (const metric of ALERT_PRESET_METRICS) await get().regenerate(metric, boardId)
  },
  async setMatchBoardConfig(metric, enabled, boardId) {
    const board = targetBoard(boardId)
    if (!board) return
    const match = { ...boardMatchBoardConfig(board), [metric]: enabled }
    await useBoardStore.getState().updateBoard({ ...board, matchBoardConfig: match })
    await get().regenerate(metric, board.id)
  },
}))

function targetBoard(boardId?: string): Board | undefined {
  const { boards, activeBoardId } = useBoardStore.getState()
  return boards.find((b) => b.id === (boardId ?? activeBoardId))
}

/** Write one metric's level into the Board's durable selection bag. */
async function persistLevel(
  board: Board,
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
): Promise<void> {
  const selection = boardAlertPresetSelection(board)
  await useBoardStore
    .getState()
    .updateBoard({ ...board, alertPreset: { ...selection, [metric]: level } })
}

/**
 * Delete every matching rule of a Board, natively and (when it is the bound Board) in the store.
 * Reads from the store when it holds this Board's rules, else straight from native — regeneration
 * runs for Boards that are not the active one too (the wizard's `regenerateAll`).
 */
async function deleteRulesWhere(
  boardId: string,
  match: (rule: AlertRule) => boolean,
): Promise<void> {
  const loaded = useAlertsStore.getState()
  const rules = loaded.boardId === boardId ? loaded.rules : await getAlertRules(boardId)
  const doomed = rules.filter(match)
  if (doomed.length === 0) return

  for (const rule of doomed) await deleteAlertRule(boardId, rule.id)
  if (useAlertsStore.getState().boardId === boardId) {
    const doomedIds = new Set(doomed.map((rule) => rule.id))
    useAlertsStore.setState((state) => ({
      rules: state.rules.filter((rule) => !doomedIds.has(rule.id)),
    }))
  }
}

async function regenerateMetric(
  boardId: string,
  metric: AlertPresetMetric,
  set: (partial: Partial<AlertPresetState>) => void,
): Promise<void> {
  const board = targetBoard(boardId)
  if (!board) return

  set({ syncing: true })
  try {
    // A matched rule persists its offset and native re-resolves it, but its `threshold` column is
    // still read by every consumer that has no config in hand (the HUD gauge, chart lines), so it
    // is written resolved. A rule whose anchor does not resolve is not written at all — a
    // placeholder threshold would draw a marker at a value the board will never act on.
    const specs = resolvedAlertPresetRules(metric, boardAlertPresetSelection(board)[metric], {
      boardTopSpeedKmh: boardTopSpeedKmh(board),
      hasBatteryConfig: boardHasBatteryConfig(board),
      matchBoardConfig: boardMatchBoardConfig(board),
      configBases: readBoardConfigBases(),
    })

    // Delete-then-upsert scoped to this metric's preset rules, so other metrics' preset rules and
    // every rider-owned rule survive untouched. `off` and `custom` (empty specs) just remove them.
    await deleteRulesWhere(board.id, (rule) => rule.controlId === metric && isPresetAlertRule(rule))

    const createdAt = Date.now()
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index]!
      await useAlertsStore.getState().upsert({
        boardId: board.id,
        id: presetAlertRuleId(metric, index),
        controlId: spec.controlId,
        threshold: spec.threshold,
        thresholdMax: spec.thresholdMax,
        thresholdRule: spec.thresholdRule,
        enabled: true,
        soundType: spec.soundType,
        repeatEverySeconds: spec.repeatEverySeconds,
        beepCount: spec.beepCount,
        createdAt,
        source: ALERT_PRESET_SOURCE,
      })
    }
  } finally {
    set({ syncing: false })
  }
}
