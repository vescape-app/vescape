import { useMemo } from 'react'

import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { DUTY_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
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

const cfg = telemetry.duty
const CHART_HEIGHT = 120

export default function DutyScreen() {
  const duty = useLiveMetric(liveSelectors.duty)
  const windowMs = useLiveWindowMs()
  const excludedRanges = useLiveExcludedRanges('max_duty')

  const charts = useMemo(
    () => [
      toLiveChart({
        key: 'duty',
        metric: cfg,
        data: toChartSeries(duty, windowMs),
        range: cfg.chartRange,
        height: CHART_HEIGHT,
        bands: toChartBands(excludedRanges),
      }),
    ],
    [duty, excludedRanges, windowMs],
  )

  return (
    <ControlDetailLayout
      title={cfg.label}
      controlId={cfg.controlId}
      unit={cfg.unit}
      liveValue={liveTelemetryRuntime.values.dutyPercent}
    >
      <LiveChartStack charts={charts} />
      <BoardConfigSection rows={DUTY_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}
