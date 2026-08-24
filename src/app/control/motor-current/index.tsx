import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { MOTOR_CURRENT_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { MetricDetailGauge } from '@/modules/board/components/MetricDetailGauge'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const cfg = telemetry.motorCurrent
const CHART_HEIGHT = 120

export default function MotorCurrentScreen() {
  const motorCurrent = useLiveMetric(liveSelectors.motorCurrent)
  const windowMs = useLiveWindowMs()

  const charts = useMemo(() => {
    const data = toChartSeries(motorCurrent, windowMs)
    return [
      toLiveChart({
        key: 'motorCurrent',
        metric: cfg,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: cfg.chartRange }),
        height: CHART_HEIGHT,
      }),
    ]
  }, [motorCurrent, windowMs])

  return (
    <ControlDetailLayout
      title={cfg.label}
      controlId={cfg.controlId!}
      unit={cfg.unit}
      gauge={<MetricDetailGauge metric={cfg} value={liveTelemetryRuntime.values.motorCurrent} />}
    >
      <LiveChartStack charts={charts} />
      <BoardConfigSection rows={MOTOR_CURRENT_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}
