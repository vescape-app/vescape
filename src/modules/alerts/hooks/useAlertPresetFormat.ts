import { useCallback } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import {
  describeAlertRules,
  type AlertRulePresentation,
  formatAlertPresetSummary,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'

/** Bind preset summaries and descriptions to the rider's current display units. */
export function useAlertPresetFormat() {
  const distanceUnit = useDistanceUnit()
  const formatSummary = useCallback(
    (metric: AlertPresetMetric, rules: AlertRulePresentation[]) =>
      formatAlertPresetSummary(metric, rules, distanceUnit),
    [distanceUnit],
  )
  const describeRules = useCallback(
    (metric: AlertPresetMetric, rules: readonly AlertRulePresentation[]) =>
      describeAlertRules(metric, rules, distanceUnit),
    [distanceUnit],
  )
  return { formatSummary, describeRules }
}
