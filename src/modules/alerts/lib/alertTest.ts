import type { UnitSystem } from '@/helpers/units'
import type { AlertTestRule } from 'vescape-core'

import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import {
  resolvedAlertPresetRules,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'

interface AlertTestRuleSource {
  metric: AlertPresetMetric
  level: AlertPresetLevel
  customRules: DraftAlertRule[]
  speedUnitSystem?: UnitSystem
  boardTopSpeedKmh: number
  hasBatteryConfig: boolean
  matchBoardConfig?: Partial<Record<AlertPresetMetric, boolean>>
  configBases?: BoardConfigBases
}

/** Cubic ease-out: reach the alert range early, then decelerate without extending the sweep. */
export function highRangeAlertTestEasing(progress: number): number {
  'worklet'
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const remaining = 1 - progress
  return 1 - remaining * remaining * remaining
}

/** Battery drains promptly from full, then continuously slows as it approaches empty. */
export function batteryDrainAlertTestEasing(progress: number): number {
  'worklet'
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const remaining = 1 - progress
  return 1 - remaining * remaining * remaining
}

/**
 * Freeze the currently visible alert setup into the minimal native test contract. Draft wizard
 * rules and saved Board rules intentionally become identical here.
 */
export function buildAlertTestRules({
  metric,
  level,
  customRules,
  speedUnitSystem,
  boardTopSpeedKmh,
  hasBatteryConfig,
  matchBoardConfig,
  configBases,
}: AlertTestRuleSource): AlertTestRule[] {
  if (level === 'custom') {
    return customRules.filter((rule) => rule.enabled).map(toTestRule)
  }

  // Dormant config-relative rules are left out: they have no threshold to test or draw.
  const presetRules = resolvedAlertPresetRules(metric, level, {
    speedUnitSystem,
    boardTopSpeedKmh,
    hasBatteryConfig,
    matchBoardConfig,
    configBases,
  }).map((rule, index) => ({
    id: `alert-test:preset:${metric}:${index}`,
    ...rule,
  }))
  // Manual rules may coexist with a generated preset for the same metric. Test the whole visible
  // setup, matching the production coordinator's combined rule list.
  return [...presetRules, ...customRules.filter((rule) => rule.enabled).map(toTestRule)]
}

/** Deduplicate the start and optional ceiling of every visible rule for chart rendering. */
export function getAlertThresholdValues(rules: AlertTestRule[]): number[] {
  const values = new Set<number>()
  for (const rule of rules) {
    if (Number.isFinite(rule.threshold)) values.add(rule.threshold)
    if (rule.thresholdMax != null && Number.isFinite(rule.thresholdMax)) {
      values.add(rule.thresholdMax)
    }
  }
  return [...values].sort((a, b) => a - b)
}

export function toTestRule(rule: DraftAlertRule): AlertTestRule {
  return {
    id: `alert-test:custom:${rule.id}`,
    controlId: rule.controlId,
    threshold: rule.threshold,
    thresholdMax: rule.thresholdMax,
    soundType: rule.soundType,
    repeatEverySeconds: rule.repeatEverySeconds,
    beepCount: rule.beepCount,
  }
}
