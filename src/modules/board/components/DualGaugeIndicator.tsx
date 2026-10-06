import { useMemo, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

import { DualGauge } from '@/modules/board/components/DualGauge'
import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
import { gaugeAlertsFor } from '@/modules/alerts/lib/gaugeAlerts'
import { boardTopSpeedKmh } from '@/modules/alerts/lib/boardAlertSettings'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
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
  const alertRules = useResolvedAlertRules()
  const gradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
  const hotRanges = useSettingsStore((s) => s.historyMetricHotRanges)
  const speedHotRange = getHistoryMetricHotRange('speed', hotRanges, gradientsEnabled)
  const dutyHotRange = getHistoryMetricHotRange('duty', hotRanges, gradientsEnabled)

  const speedAlerts = useMemo(() => gaugeAlertsFor(alertRules, 'speed'), [alertRules])
  const dutyAlerts = useMemo(() => gaugeAlertsFor(alertRules, 'duty'), [alertRules])

  return (
    <DualGauge
      speedValue={liveTelemetryRuntime.values.speedKmh}
      dutyValue={liveTelemetryRuntime.values.dutyPercent}
      speedPeak={liveTelemetryRuntime.values.speedPeakKmh}
      dutyPeak={liveTelemetryRuntime.values.dutyPeakPercent}
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
