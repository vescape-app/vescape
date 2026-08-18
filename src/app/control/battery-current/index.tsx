import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { MetricDetailGauge } from '@/modules/board/components/MetricDetailGauge'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const cfg = telemetry.battCurrent
const CHART_HEIGHT = 120

export default function BatteryCurrentScreen() {
  const batteryCurrent = useLiveMetric(liveSelectors.batteryCurrent)
  const windowMs = useLiveWindowMs()

  const charts = useMemo(() => {
    const data = toChartSeries(batteryCurrent, windowMs)
    return [
      toLiveChart({
        key: 'batteryCurrent',
        metric: cfg,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: cfg.chartRange }),
        height: CHART_HEIGHT,
      }),
    ]
  }, [batteryCurrent, windowMs])

  return (
    <ControlDetailLayout
      title={cfg.label}
      controlId={cfg.controlId!}
      unit={cfg.unit}
      gauge={<MetricDetailGauge metric={cfg} value={liveTelemetryRuntime.values.batteryCurrent} />}
    >
      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}
