import { useCallback } from 'react'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  describeAlertRules,
  type AlertRulePresentation,
  formatAlertPresetSummary,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'

export function useAlertPresetFormat() {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
  const formatSummary = useCallback(
    (metric: AlertPresetMetric, rules: AlertRulePresentation[]) =>
      formatAlertPresetSummary(metric, rules, distanceUnit, temperatureUnit),
    [distanceUnit, temperatureUnit],
  )
  const describeRules = useCallback(
    (metric: AlertPresetMetric, rules: readonly AlertRulePresentation[]) =>
      describeAlertRules(metric, rules, distanceUnit, temperatureUnit),
    [distanceUnit, temperatureUnit],
  )
  return { formatSummary, describeRules }
}
