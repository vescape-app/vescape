import { useMemo } from 'react'

import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
import { gaugeAlertsFor } from '@/modules/alerts/lib/gaugeAlerts'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import {
  getHistoryMetricHotRange,
  getHistoryMetricKeyForControlId,
} from '@/modules/history/lib/metricColorScale'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** The metric's enabled alert marks and its hot colour range, as every live gauge draws them. */
export function useMetricGaugeDecor(metric: TelemetryMetricConfig) {
  const alertRules = useResolvedAlertRules()
  const gradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
  const hotRanges = useSettingsStore((s) => s.historyMetricHotRanges)
  const hotMetric = getHistoryMetricKeyForControlId(metric.controlId)
  const hotRange = hotMetric
    ? getHistoryMetricHotRange(hotMetric, hotRanges, gradientsEnabled)
    : null

  const alerts = useMemo(
    () => (metric.controlId == null ? [] : gaugeAlertsFor(alertRules, metric.controlId)),
    [alertRules, metric.controlId],
  )

  return { alerts, hotRange }
}
