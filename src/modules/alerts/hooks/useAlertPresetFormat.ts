import { useCallback } from 'react'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import {
  describeAlertRules,
  type AlertRuleSpec,
  formatAlertPresetSummary,
  type AlertPresetLevel,
  type AlertPresetMetric,
  type GenerateAlertPresetRulesOptions,
} from '@/modules/alerts/lib/alertPresets'

/** Bind preset summaries and descriptions to the rider's current display units. */
export function useAlertPresetFormat() {
  const units = useUnitSystem()
  const formatSummary = useCallback(
    (
      metric: AlertPresetMetric,
      level: AlertPresetLevel,
      options: GenerateAlertPresetRulesOptions = {},
    ) => formatAlertPresetSummary(metric, level, options, units),
    [units],
  )
  const describeRules = useCallback(
    (
      metric: AlertPresetMetric,
      rules: readonly Pick<AlertRuleSpec, 'threshold' | 'thresholdMax' | 'repeatEverySeconds'>[],
    ) => describeAlertRules(metric, rules, units),
    [units],
  )
  return { formatSummary, describeRules }
}
