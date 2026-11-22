import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'

export function gaugeAlertsFor(
  rules: readonly DraftAlertRule[],
  controlId: string,
): DualGaugeAlert[] {
  return rules
    .filter((rule) => rule.enabled && rule.controlId === controlId)
    .map((rule) => ({
      id: rule.id,
      threshold: rule.threshold,
      thresholdMax: rule.thresholdMax,
      repeats: rule.repeatEverySeconds != null,
    }))
}
