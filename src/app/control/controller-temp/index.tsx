import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { CONTROLLER_TEMP_CONFIG_ROWS } from '@/modules/board/constants/motorConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

const cfg = telemetry.controllerTemp
const CHART_HEIGHT = 120

export default function ControllerTempScreen() {
  const controllerTemp = useLiveMetric(liveSelectors.controllerTemp)
  const windowMs = useLiveWindowMs()
  const motorConfig = useMotorConfigFields()

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
      <BoardConfigSection
        title="Motor config"
        rows={CONTROLLER_TEMP_CONFIG_ROWS}
        values={motorConfig}
        empty="No motor config read from this board yet. Connect it to read its cutoffs."
      />
    </ControlDetailLayout>
  )
}
