import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { ImuAttitudeDial } from '@/modules/board/components/ImuAttitudeDial'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { IMU_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { liveSelectors, useLiveMetric } from '@/modules/board/hooks/useLiveMetric'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const pitchCfg = telemetry.pitch
const rollCfg = telemetry.roll
const balanceCfg = telemetry.balancePitch

export default function ImuScreen() {
  const pitch = useLiveMetric(liveSelectors.pitch)
  const roll = useLiveMetric(liveSelectors.roll)
  const balancePitch = useLiveMetric(liveSelectors.balancePitch)
  const windowMs = useLiveWindowMs()
  const hot = liveTelemetryRuntime.values
  const connected = useBleStore((s) => s.status === 'connected')

  // Pitch, roll and balance in one stack: they are read against each other, and one gesture over
  // the column puts the same moment under the finger on all three.
  const charts = useMemo(() => {
    const series = [
      { key: 'pitch', metric: pitchCfg, data: toChartSeries(pitch, windowMs) },
      { key: 'roll', metric: rollCfg, data: toChartSeries(roll, windowMs) },
      { key: 'balancePitch', metric: balanceCfg, data: toChartSeries(balancePitch, windowMs) },
    ]
    return series.map(({ key, metric, data }) =>
      toLiveChart({
        key,
        metric,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: metric.chartRange }),
      }),
    )
  }, [balancePitch, pitch, roll, windowMs])

  return (
    <ControlDetailLayout
      title="IMU"
      gauge={
        <ImuAttitudeDial
          pitch={hot.pitch}
          roll={hot.roll}
          balancePitch={hot.balancePitch}
          connected={connected}
        />
      }
    >
      <LiveChartStack charts={charts} />
      <BoardConfigSection rows={IMU_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}
