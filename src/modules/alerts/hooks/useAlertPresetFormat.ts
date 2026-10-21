import { useCallback } from 'react'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import {
  describeAlertRules,
  type AlertRulePresentation,
  formatAlertPresetSummary,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'

/** Bind preset summaries and descriptions to the rider's current display units. */
export function useAlertPresetFormat() {
  const units = useUnitSystem()
  const formatSummary = useCallback(
    (metric: AlertPresetMetric, rules: AlertRulePresentation[]) =>
      formatAlertPresetSummary(metric, rules, units),
    [units],
  )
  const describeRules = useCallback(
    (metric: AlertPresetMetric, rules: readonly AlertRulePresentation[]) =>
      describeAlertRules(metric, rules, units),
    [units],
  )
  return { formatSummary, describeRules }
}
