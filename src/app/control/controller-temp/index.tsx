import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const cfg = telemetry.controllerTemp
const CHART_HEIGHT = 120

export default function ControllerTempScreen() {
  const controllerTemp = useLiveMetric(liveSelectors.controllerTemp)
  const windowMs = useLiveWindowMs()

  const charts = useMemo(() => {
    const data = toChartSeries(controllerTemp, windowMs)
    return [
      toLiveChart({
        key: 'controllerTemp',
        metric: cfg,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: cfg.chartRange }),
        height: CHART_HEIGHT,
      }),
    ]
  }, [controllerTemp, windowMs])

  return (
    <ControlDetailLayout
      title="Controller Temperature"
      controlId={cfg.controlId!}
      unit={cfg.unit}
      liveValue={liveTelemetryRuntime.values.controllerTemp}
    >
      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}
