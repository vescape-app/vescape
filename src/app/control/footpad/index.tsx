import { useMemo } from 'react'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { useFootpadThreshold } from '@/modules/board/store/boardConfigValuesStore'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const adc1 = telemetry.footpadAdc1
const adc2 = telemetry.footpadAdc2

/**
 * The zone's engagement voltage as a chart reference line, or nothing to draw.
 *
 * No config yet means no line rather than a guessed one, and `fault_adc = 0` means the switch is
 * disabled — a line at zero would read as a threshold the rider could cross.
 */
function thresholdLines(threshold: number | null): number[] | undefined {
  return threshold != null && threshold > 0 ? [threshold] : undefined
}

export default function FootpadScreen() {
  const adc1Data = useLiveMetric(liveSelectors.footpadAdc1)
  const adc2Data = useLiveMetric(liveSelectors.footpadAdc2)
  const adc1Threshold = useFootpadThreshold(0)
  const adc2Threshold = useFootpadThreshold(1)
  const windowMs = useLiveWindowMs()

  // Both sensors in one stack: a footpad is read by comparing them, and one gesture over the
  // pair puts the same moment under the finger on both.
  const charts = useMemo(() => {
    const first = toChartSeries(adc1Data, windowMs)
    const second = toChartSeries(adc2Data, windowMs)
    const firstLines = thresholdLines(adc1Threshold)
    const secondLines = thresholdLines(adc2Threshold)
    // The threshold goes into the range input, not beside it: a line the axis crops off is worse
    // than no line at all.
    return [
      toLiveChart({
        key: 'footpadAdc1',
        metric: adc1,
        data: first,
        range: computeAutoRangeFromValues([...first.vs, ...(firstLines ?? [])], {
          baseline: adc1.chartRange,
        }),
        thresholds: firstLines,
      }),
      toLiveChart({
        key: 'footpadAdc2',
        metric: adc2,
        data: second,
        range: computeAutoRangeFromValues([...second.vs, ...(secondLines ?? [])], {
          baseline: adc2.chartRange,
        }),
        thresholds: secondLines,
      }),
    ]
  }, [adc1Data, adc2Data, adc1Threshold, adc2Threshold, windowMs])

  return (
    <ControlDetailLayout title="Footpad">
      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}
