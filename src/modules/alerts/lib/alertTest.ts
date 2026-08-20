import type { AlertTestRule } from 'vescape-core'

import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import {
  generateAlertPresetRules,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'

interface AlertTestRuleSource {
  metric: AlertPresetMetric
  level: AlertPresetLevel
  customRules: DraftAlertRule[]
  boardTopSpeedKmh: number
  hasBatteryConfig: boolean
  matchDutyBoardConfig?: boolean
  tiltbackDuty?: number | null
}

interface MetricAlertRuleSnapshotSource {
  metric: AlertPresetMetric | null
  level: AlertPresetLevel
  rules: DraftAlertRule[]
  boardTopSpeedKmh: number
  hasBatteryConfig: boolean
  matchDutyBoardConfig?: boolean
  tiltbackDuty?: number | null
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
  boardTopSpeedKmh,
  hasBatteryConfig,
  matchDutyBoardConfig,
  tiltbackDuty,
}: AlertTestRuleSource): AlertTestRule[] {
  if (level === 'custom') {
    return customRules.filter((rule) => rule.enabled).map(toTestRule)
  }

  const presetRules = generateAlertPresetRules(metric, level, {
    boardTopSpeedKmh,
    hasBatteryConfig,
    matchDutyBoardConfig,
    tiltbackDuty,
  }).map((rule, index) => ({
    id: `alert-test:preset:${metric}:${index}`,
    ...rule,
  }))
  // Manual rules may coexist with a generated preset for the same metric. Test the whole visible
  // setup, matching the production coordinator's combined rule list.
  return [...presetRules, ...customRules.filter((rule) => rule.enabled).map(toTestRule)]
}

/**
 * Freeze every enabled rule currently represented by one metric's UI. The same snapshot drives
 * the native sound test and the history-chart reference lines, so neither visualization can
 * drift away from the alert engine's inputs.
 */
export function buildMetricAlertRuleSnapshot({
  metric,
  level,
  rules,
  boardTopSpeedKmh,
  hasBatteryConfig,
  matchDutyBoardConfig,
  tiltbackDuty,
}: MetricAlertRuleSnapshotSource): AlertTestRule[] {
  if (!metric) return rules.filter((rule) => rule.enabled).map(toTestRule)
  return buildAlertTestRules({
    metric,
    level,
    customRules: rules,
    boardTopSpeedKmh,
    hasBatteryConfig,
    matchDutyBoardConfig,
    tiltbackDuty,
  })
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

function toTestRule(rule: DraftAlertRule): AlertTestRule {
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
