import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { SpeakerHighIcon, StopIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { useAlertTest } from '@/modules/alerts/hooks/useAlertTest'
import { toTestRule } from '@/modules/alerts/lib/alertTest'
import { SingleGauge } from '@/modules/board/components/SingleGauge'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import {
  getHistoryMetricHotRange,
  getHistoryMetricKeyForControlId,
} from '@/modules/history/lib/metricColorScale'
import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

interface MetricDetailGaugeProps {
  metric: TelemetryMetricConfig
  value: SharedValue<number | null>
  min?: number
  max?: number
}

export function MetricDetailGauge({
  metric,
  value,
  min = metric.chartRange.min,
  max = metric.chartRange.max,
}: MetricDetailGaugeProps) {
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
  const testRules = useMemo(
    () => alertRules.filter((rule) => rule.controlId === metric.controlId).map(toTestRule),
    [alertRules, metric.controlId],
  )
  const alertTest = useAlertTest({
    rules: testRules,
    min,
    max,
    alertAbove: true,
    lingerNearMax: false,
    slowForMessages: true,
  })
  const gaugeValue = alertTest.running ? alertTest.value : value

  return (
    <SingleGauge
      value={gaugeValue}
      min={min}
      max={max}
      color={metric.color}
      unit={metric.unit}
      decimals={metric.decimals}
      alerts={alerts}
      hotRange={hotRange}
      headerRight={
        <Button
          label={alertTest.running ? 'Stop' : 'Preview'}
          icon={alertTest.running ? StopIcon : SpeakerHighIcon}
          variant="caution"
          size="sm"
          disabled={!alertTest.canRun}
          onPress={alertTest.running ? alertTest.stop : alertTest.start}
          testID={`alert-test-${metric.controlId}`}
          style={styles.testButton}
        />
      }
      containerStyle={styles.gauge}
    />
  )
}

const styles = StyleSheet.create({
  gauge: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  testButton: {
    height: 28,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
})
