import { useMemo, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

import { DualGauge } from '@/modules/board/components/DualGauge'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { boardTopSpeedKmh } from '@/modules/alerts/lib/boardAlertSettings'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useLiveSeries } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs, useSettingsStore } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { getHistoryMetricHotRange } from '@/modules/history/lib/metricColorScale'

const DUTY_MAX = 100

interface DualGaugeIndicatorProps {
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
  /** Hangs off the bottom of the arcs — status that qualifies what the gauges are reading. */
  footer?: ReactNode
}

export function DualGaugeIndicator({
  compact,
  transparent,
  containerStyle,
  footer,
}: DualGaugeIndicatorProps) {
  // Full-scale follows the active Board's Top Speed, same as the speed detail gauge — otherwise
  // a 30 km/h board's alert markers sit in a different place on each screen.
  const activeBoard = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const speedMax = boardTopSpeedKmh(activeBoard)
  const speedSeries = useLiveSeries('speed')
  const dutySeries = useLiveSeries('duty')
  const windowMs = useLiveWindowMs()
  const alertRules = useAlertsStore((s) => s.rules)
  const gradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
  const hotRanges = useSettingsStore((s) => s.historyMetricHotRanges)
  const speedHotRange = getHistoryMetricHotRange('speed', hotRanges, gradientsEnabled)
  const dutyHotRange = getHistoryMetricHotRange('duty', hotRanges, gradientsEnabled)

  const speedAlerts = useMemo(
    () =>
      alertRules
        .filter((rule) => rule.enabled && rule.controlId === 'speed')
        .map((rule) => ({
          id: rule.id,
          threshold: rule.threshold,
          thresholdMax: rule.thresholdMax,
          repeats: rule.repeatEverySeconds != null,
        })),
    [alertRules],
  )

  const dutyAlerts = useMemo(
    () =>
      alertRules
        .filter((rule) => rule.enabled && rule.controlId === 'duty')
        .map((rule) => ({
          id: rule.id,
          threshold: rule.threshold,
          thresholdMax: rule.thresholdMax,
          repeats: rule.repeatEverySeconds != null,
        })),
    [alertRules],
  )

  return (
    <DualGauge
      speedValue={liveTelemetryRuntime.values.speedKmh}
      dutyValue={liveTelemetryRuntime.values.dutyPercent}
      speedSeries={speedSeries}
      dutySeries={dutySeries}
      windowMs={windowMs}
      speedMax={speedMax}
      dutyMax={DUTY_MAX}
      speedHotRange={speedHotRange}
      dutyHotRange={dutyHotRange}
      speedAlerts={speedAlerts}
      dutyAlerts={dutyAlerts}
      compact={compact}
      transparent={transparent}
      containerStyle={containerStyle}
      footer={footer}
    />
  )
}
