import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { generateId } from '@/helpers/id'
import {
  asAlertPresetMetric,
  ALERT_PRESET_FALLBACK_LEVEL,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import {
  boardAlertPresetSelection,
  boardHasBatteryConfig,
  boardTopSpeedKmh,
} from '@/modules/alerts/lib/boardAlertSettings'
import {
  customRulesForControl,
  materializePresetRules,
  type DraftAlertRule,
} from '@/modules/alerts/lib/customAlertRules'
import { useAlertPresetStore } from '@/modules/alerts/store/alertPresetStore'
import { useAlertsStore, type AlertRuleDraft } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

/**
 * Everything the alert block of a control needs, independent of where the setup is stored.
 *
 * Two backings implement it: {@link useBoardMetricAlerts} writes through to a saved Board, and
 * {@link useDraftMetricAlerts} writes into the add-board wizard's in-memory draft. The UI renders
 * a controller and never learns which one it got — that is what lets the wizard offer the same
 * editing as `/control` before a Board exists to own the rules.
 */
export interface MetricAlertsController {
  /** The preset metric this control maps to, or `null` when it only supports custom rules. */
  metric: AlertPresetMetric | null
  controlId: string
  /** `custom` ⇒ {@link rules} are the rider's; a generated level ⇒ they are derived. */
  level: AlertPresetLevel
  /** Rider-owned rules for this control. Preset-generated rules never appear here. */
  rules: DraftAlertRule[]
  topSpeedKmh: number
  hasBatteryConfig: boolean
  setLevel(level: AlertPresetLevel): void
  /** Copy the current level's rules into {@link rules} and switch to `custom`. */
  customize(): void
  /** Drop every rule in {@link rules} and return to a generated level. */
  discardCustom(): void
  addRule(draft: AlertRuleDraft): void
  updateRule(id: string, draft: AlertRuleDraft): void
  toggleRule(id: string): void
  removeRule(id: string): void
}

/**
 * Controller backed by the active Board. `null` when there is no Board — Alert Rules are
 * board-owned (#254), so with none there is nothing to write to and the UI shows its empty state
 * instead of controls that would silently no-op.
 */
export function useBoardMetricAlerts(controlId: string): MetricAlertsController | null {
  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const allRules = useAlertsStore((s) => s.rules)
  const { add, update, toggle, remove } = useAlertsStore(
    useShallow((s) => ({ add: s.add, update: s.update, toggle: s.toggle, remove: s.remove })),
  )

  const metric = asAlertPresetMetric(controlId)
  const rules = useMemo(() => customRulesForControl(allRules, controlId), [allRules, controlId])
  // Controls without presets are always rider-owned, so they read as `custom` with no way back.
  const level = board && metric ? boardAlertPresetSelection(board)[metric] : 'custom'

  return useMemo(() => {
    if (!board) return null
    const presets = () => useAlertPresetStore.getState()
    return {
      metric,
      controlId,
      level,
      rules,
      topSpeedKmh: boardTopSpeedKmh(board),
      hasBatteryConfig: boardHasBatteryConfig(board),
      setLevel: (next) => {
        if (metric) void presets().setLevel(metric, next)
      },
      customize: () => {
        if (metric) void presets().customize(metric)
      },
      discardCustom: () => {
        if (metric) void presets().discardCustom(metric)
      },
      addRule: (draft) => add(controlId, draft),
      updateRule: (id, draft) => update(id, draft),
      toggleRule: (id) => void toggle(id),
      removeRule: (id) => void remove(id),
    }
  }, [board, metric, controlId, level, rules, add, update, toggle, remove])
}

/** One metric's buffered alert setup inside the add-board wizard. */
export interface DraftAlertSetup {
  level: AlertPresetLevel
  rules: DraftAlertRule[]
}

interface DraftMetricAlertsSource {
  setup: DraftAlertSetup
  topSpeedKmh: number
  hasBatteryConfig: boolean
  onChange(next: DraftAlertSetup): void
}

/**
 * Controller backed by the add-board wizard's draft. Identical semantics to the Board-backed one,
 * held in memory: the wizard buffers name, battery, top speed and alert setup alike, and flushes
 * everything once `addBoard` hands it an id to stamp onto the rules.
 */
export function useDraftMetricAlerts(
  metric: AlertPresetMetric,
  { setup, topSpeedKmh, hasBatteryConfig, onChange }: DraftMetricAlertsSource,
): MetricAlertsController {
  return useMemo(() => {
    const withRules = (rules: DraftAlertRule[]) => onChange({ ...setup, rules })
    const mapRule = (id: string, change: (rule: DraftAlertRule) => DraftAlertRule) =>
      withRules(setup.rules.map((rule) => (rule.id === id ? change(rule) : rule)))

    return {
      metric,
      controlId: metric,
      level: setup.level,
      rules: setup.rules,
      topSpeedKmh,
      hasBatteryConfig,
      setLevel: (level) => onChange({ level, rules: setup.rules }),
      customize: () =>
        onChange({
          level: 'custom',
          rules: materializePresetRules(metric, setup.level, {
            boardTopSpeedKmh: topSpeedKmh,
            hasBatteryConfig,
          }),
        }),
      discardCustom: () => onChange({ level: ALERT_PRESET_FALLBACK_LEVEL, rules: [] }),
      addRule: (draft) =>
        withRules([
          ...setup.rules,
          {
            id: generateId(),
            controlId: metric,
            enabled: true,
            createdAt: Date.now(),
            ...draft,
          },
        ]),
      updateRule: (id, draft) => mapRule(id, (rule) => ({ ...rule, ...draft })),
      toggleRule: (id) => mapRule(id, (rule) => ({ ...rule, enabled: !rule.enabled })),
      removeRule: (id) => withRules(setup.rules.filter((rule) => rule.id !== id)),
    }
  }, [metric, setup, topSpeedKmh, hasBatteryConfig, onChange])
}
