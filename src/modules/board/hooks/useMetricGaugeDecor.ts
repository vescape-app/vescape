import { useMemo } from 'react'

import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
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

  const alerts = useMemo<DualGaugeAlert[]>(
    () =>
      metric.controlId == null
        ? []
        : alertRules
            .filter((rule) => rule.enabled && rule.controlId === metric.controlId)
            .map((rule) => ({
              id: rule.id,
              threshold: rule.threshold,
              thresholdMax: rule.thresholdMax,
              repeats: rule.repeatEverySeconds != null,
            })),
    [alertRules, metric.controlId],
  )

  return { alerts, hotRange, alertRules }
}
