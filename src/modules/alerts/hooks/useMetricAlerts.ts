import { draftAlertPreview } from '@/modules/alerts/lib/draftAlertPreview'
import type { AlertTestRule } from 'vescape-core'
import { useBoardConfigBases } from '@/modules/alerts/hooks/useBoardConfigBases'
import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
import { toTestRule } from '@/modules/alerts/lib/alertTest'
import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { generateId } from '@/helpers/id'
import {
  alertPresetState,
  asAlertPresetMetric,
  isPresetAlertRule,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { boardHasBatteryConfig, boardTopSpeedKmh } from '@/modules/alerts/lib/boardAlertSettings'
import { customRulesForControl, type DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import { useAlertPresetStore } from '@/modules/alerts/store/alertPresetStore'
import {
  formatGeigerAlertSound,
  parseGeigerAlertSound,
} from '@/modules/alerts/lib/alertSoundString'
import { useAlertsStore, type AlertRuleDraft } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { deriveBatteryConfig } from '@/modules/battery/lib'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import type { BatteryConfig } from 'vescape-core'

/** The derived battery config, or null when it is missing or invalid. */
export function validBatteryConfig(config: BatteryConfig | null): DerivedBatteryConfig | null {
  const derived = deriveBatteryConfig(config)
  return derived.warning == null ? derived : null
}

/**
 * Everything the alert block of a control needs, independent of where the setup is stored.
 *
 * Two backings implement it: {@link useBoardMetricAlerts} writes through to a saved Board, and
 * {@link useDraftMetricAlerts} writes into the add-board wizard's in-memory draft. The UI renders
 * a controller and never learns which one it got — that is what lets the wizard offer the same
 * editing as `/control` before a Board exists to own the rules.
 */
export interface MetricAlertsController {
  /** Failure of a rider-rule write, shown with the rules and the rule form. */
  error: string | null
  /** Failure of a preset write or expansion, shown under the preset control. */
  presetError: string | null
  /** The preset metric this control maps to, or `null` when it only supports custom rules. */
  metric: AlertPresetMetric | null
  controlId: string
  /** The metric's preset level; `null` when {@link metric} is. */
  level: AlertPresetLevel | null
  /** Rider-owned rules for this control. They fire alongside the preset's; preset rules never appear here. */
  rules: DraftAlertRule[]
  /** Preset and rider rules together: gauge markers, chart lines, and sound preview. */
  ruleSnapshot: AlertTestRule[]
  /** The preset's own expanded points, for its description. */
  presetRules: AlertTestRule[]
  configBases: BoardConfigBases
  topSpeedKmh: number
  hasBatteryConfig: boolean
  /** Battery rules are state-of-charge %: the backing's own derived config, set only for a valid battery control. */
  batteryConfig: DerivedBatteryConfig | null
  /** Metrics this Board follows its own configuration for. */
  matchBoardConfig: Partial<Record<AlertPresetMetric, boolean>>
  setMatchBoardConfig(enabled: boolean): void
  /** Tick sound of this metric's preset: the rider's choice, else its expanded rules'; null without either. */
  geigerSound?: string | null
  /** Pick the preset's geiger sound. Absent where it cannot be stored (the add-board wizard). */
  setGeigerSound?(spec: string): void
  setLevel(level: AlertPresetLevel): void
  addRule(draft: AlertRuleDraft): Promise<void>
  updateRule(id: string, draft: AlertRuleDraft): Promise<void>
  toggleRule(id: string): Promise<void>
  removeRule(id: string): Promise<void>
}

/**
 * Controller backed by the active Board. `null` when there is no Board — Alert Rules are
 * board-owned (#254), so with none there is nothing to write to and the UI shows its empty state
 * instead of controls that would silently no-op.
 */
export function useBoardMetricAlerts(controlId: string): MetricAlertsController | null {
  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const resolvedRules = useResolvedAlertRules()
  const configBases = useBoardConfigBases()
  const ruleSnapshot = useMemo(
    () => resolvedRules.filter((rule) => rule.controlId === controlId).map(toTestRule),
    [resolvedRules, controlId],
  )
  // The points native expanded from this metric's preset.
  const presetRules = useMemo(
    () =>
      resolvedRules
        .filter((rule) => rule.controlId === controlId && isPresetAlertRule(rule))
        .map(toTestRule),
    [resolvedRules, controlId],
  )
  const allRules = useAlertsStore((s) => s.rules)
  const presetSpecs = useAlertsStore((s) => s.presets)
  const error = useAlertsStore((s) => s.error)
  const presetError = useAlertPresetStore((s) => s.error)
  const boardBatteryConfig = board?.batteryConfig
  const batteryConfig = useMemo(
    () => (controlId === 'battery' ? validBatteryConfig(boardBatteryConfig ?? null) : null),
    [controlId, boardBatteryConfig],
  )
  const { add, update, toggle, remove } = useAlertsStore(
    useShallow((s) => ({ add: s.add, update: s.update, toggle: s.toggle, remove: s.remove })),
  )

  const metric = asAlertPresetMetric(controlId)
  const rules = useMemo(() => customRulesForControl(allRules, controlId), [allRules, controlId])
  const preset = metric ? alertPresetState(presetSpecs[metric]) : null
  const presetGeiger = preset?.geiger
  // Only expanded preset rules hold the preset's sound; the rider's own rules carry their own.
  const geigerSound = useMemo(
    () =>
      presetGeiger
        ? formatGeigerAlertSound(presetGeiger)
        : (allRules.find(
            (rule) =>
              rule.controlId === controlId &&
              isPresetAlertRule(rule) &&
              parseGeigerAlertSound(rule.spec),
          )?.spec ?? null),
    [allRules, controlId, presetGeiger],
  )
  const level = preset?.level ?? null
  const matchBoardConfig = useMemo(
    () => (metric && preset?.match ? { [metric]: true } : {}),
    [metric, preset?.match],
  )

  return useMemo(() => {
    if (!board) return null
    const presets = () => useAlertPresetStore.getState()
    return {
      metric,
      error,
      presetError,
      controlId,
      level,
      rules,
      ruleSnapshot,
      presetRules,
      configBases,
      topSpeedKmh: boardTopSpeedKmh(board),
      hasBatteryConfig: boardHasBatteryConfig(board),
      batteryConfig,
      matchBoardConfig,
      setMatchBoardConfig: (enabled) => {
        // intentional-suppression: the Alert Preset store error renders under the preset control.
        if (metric)
          void presets()
            .setMatchBoardConfig(metric, enabled)
            .catch(() => undefined)
      },
      geigerSound,
      setGeigerSound: (spec) => {
        // intentional-suppression: the Alert Preset store error renders under the preset control.
        if (metric)
          void presets()
            .setGeigerSound(metric, spec)
            .catch(() => undefined)
      },
      setLevel: (next) => {
        // intentional-suppression: the Alert Preset store error renders under the preset control.
        if (metric)
          void presets()
            .setLevel(metric, next)
            .catch(() => undefined)
      },
      addRule: (draft) => add(controlId, draft),
      updateRule: (id, draft) => update(id, draft),
      toggleRule: (id) => toggle(id),
      removeRule: (id) => remove(id),
    }
  }, [
    board,
    metric,
    controlId,
    level,
    rules,
    error,
    presetError,
    batteryConfig,
    add,
    update,
    toggle,
    remove,
    ruleSnapshot,
    configBases,
    geigerSound,
    matchBoardConfig,
    presetRules,
  ])
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
  /** The draft's derived battery config when valid; must be referentially stable. */
  batteryConfig: DerivedBatteryConfig | null
  onChange(next: DraftAlertSetup): void
}

/**
 * Controller backed by the add-board wizard's draft. Identical semantics to the Board-backed one,
 * held in memory: the wizard buffers name, battery, top speed and alert setup alike, and flushes
 * everything once `addBoard` hands it an id to stamp onto the rules.
 */
export function useDraftMetricAlerts(
  metric: AlertPresetMetric,
  { setup, topSpeedKmh, hasBatteryConfig, batteryConfig, onChange }: DraftMetricAlertsSource,
): MetricAlertsController {
  const distanceUnit = useDistanceUnit()
  const preview = useMemo(
    () =>
      draftAlertPreview(
        metric,
        setup.level,
        { topSpeedKmh, hasBatteryConfig, distanceUnit: distanceUnit },
        setup.rules,
      ),
    [metric, setup.level, distanceUnit, setup.rules, topSpeedKmh, hasBatteryConfig],
  )
  return useMemo(() => {
    const withRules = (rules: DraftAlertRule[]) => onChange({ ...setup, rules })
    const mapRule = (id: string, change: (rule: DraftAlertRule) => DraftAlertRule) =>
      withRules(setup.rules.map((rule) => (rule.id === id ? change(rule) : rule)))

    return {
      metric,
      // Draft rules live in memory, so only the preset preview can fail.
      error: null,
      presetError: preview.error,
      controlId: metric,
      level: setup.level,
      rules: setup.rules,
      ruleSnapshot: preview.rules,
      presetRules: preview.presetRules,
      configBases: {},
      topSpeedKmh,
      hasBatteryConfig,
      batteryConfig: metric === 'battery' ? batteryConfig : null,
      // The wizard has no Board yet, so no config has been read to match against.
      matchBoardConfig: {},
      setMatchBoardConfig: () => {},
      setLevel: (level) => onChange({ ...setup, level }),
      addRule: async (draft) =>
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
      updateRule: async (id, draft) => mapRule(id, (rule) => ({ ...rule, ...draft })),
      toggleRule: async (id) => mapRule(id, (rule) => ({ ...rule, enabled: !rule.enabled })),
      removeRule: async (id) => withRules(setup.rules.filter((rule) => rule.id !== id)),
    }
  }, [metric, setup, topSpeedKmh, hasBatteryConfig, batteryConfig, onChange, preview])
}
