import { useMemo } from 'react'

import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import {
  toChartBands,
  toChartSeries,
  toLiveChart,
} from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  useLiveMetric,
  useLiveExcludedRanges,
  liveSelectors,
} from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const cfg = telemetry.speed
const CHART_HEIGHT = 120

export default function SpeedScreen() {
  const speed = useLiveMetric(liveSelectors.speed)
  const windowMs = useLiveWindowMs()
  const excludedRanges = useLiveExcludedRanges('avg_speed', 'max_speed')

  const charts = useMemo(
    () => [
      toLiveChart({
        key: 'speed',
        metric: cfg,
        data: toChartSeries(speed, windowMs),
        range: cfg.chartRange,
        height: CHART_HEIGHT,
        bands: toChartBands(excludedRanges),
      }),
    ],
    [excludedRanges, speed, windowMs],
  )

  return (
    <ControlDetailLayout
      title={cfg.label}
      controlId={cfg.controlId}
      unit={cfg.unit}
      liveValue={liveTelemetryRuntime.values.speedKmh}
    >
      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}
