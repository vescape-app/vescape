import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { MotorConfigSection } from '@/modules/board/components/MotorConfigSection'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { MOTOR_TEMP_CONFIG_ROWS } from '@/modules/board/constants/motorConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const cfg = telemetry.motorTemp
const CHART_HEIGHT = 120

export default function MotorTempScreen() {
  const motorTemp = useLiveMetric(liveSelectors.motorTemp)
  const windowMs = useLiveWindowMs()

  const charts = useMemo(() => {
    const data = toChartSeries(motorTemp, windowMs)
    return [
      toLiveChart({
        key: 'motorTemp',
        metric: cfg,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: cfg.chartRange }),
        height: CHART_HEIGHT,
      }),
    ]
  }, [motorTemp, windowMs])

  return (
    <ControlDetailLayout
      title="Motor Temperature"
      controlId={cfg.controlId!}
      unit={cfg.unit}
      liveValue={liveTelemetryRuntime.values.motorTemp}
    >
      <LiveChartStack charts={charts} />
      <MotorConfigSection rows={MOTOR_TEMP_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}
