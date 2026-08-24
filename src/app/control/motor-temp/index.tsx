import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { MOTOR_TEMP_CONFIG_ROWS } from '@/modules/board/constants/motorConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

const cfg = telemetry.motorTemp
const CHART_HEIGHT = 120

export default function MotorTempScreen() {
  const motorTemp = useLiveMetric(liveSelectors.motorTemp)
  const windowMs = useLiveWindowMs()
  const motorConfig = useMotorConfigFields()

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
      <BoardConfigSection
        title="Motor config"
        rows={MOTOR_TEMP_CONFIG_ROWS}
        values={motorConfig}
        empty="No motor config read from this board yet. Connect it to read its cutoffs."
      />
    </ControlDetailLayout>
  )
}
