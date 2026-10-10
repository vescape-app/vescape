import type { AlertTestRule } from 'vescape-core'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'

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
