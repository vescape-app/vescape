import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const adc1 = telemetry.footpadAdc1
const adc2 = telemetry.footpadAdc2

export default function FootpadScreen() {
  const adc1Data = useLiveMetric(liveSelectors.footpadAdc1)
  const adc2Data = useLiveMetric(liveSelectors.footpadAdc2)
  const windowMs = useLiveWindowMs()

  // Both sensors in one stack: a footpad is read by comparing them, and one gesture over the
  // pair puts the same moment under the finger on both.
  const charts = useMemo(() => {
    const first = toChartSeries(adc1Data, windowMs)
    const second = toChartSeries(adc2Data, windowMs)
    return [
      toLiveChart({
        key: 'footpadAdc1',
        metric: adc1,
        data: first,
        range: computeAutoRangeFromValues(first.vs, { baseline: adc1.chartRange }),
      }),
      toLiveChart({
        key: 'footpadAdc2',
        metric: adc2,
        data: second,
        range: computeAutoRangeFromValues(second.vs, { baseline: adc2.chartRange }),
      }),
    ]
  }, [adc1Data, adc2Data, windowMs])

  return (
    <ControlDetailLayout title="Footpad">
      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}
