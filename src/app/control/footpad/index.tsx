import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { FOOTPAD_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
import { FootpadIndicator } from '@/modules/board/components/FootpadIndicator'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { useFootpadThreshold, usePosiSensor } from '@/modules/board/store/boardConfigValuesStore'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const adc1 = telemetry.footpadAdc1
const adc2 = telemetry.footpadAdc2

function thresholdLines(threshold: number | null): number[] | undefined {
  return threshold != null && threshold > 0 ? [threshold] : undefined
}

export default function FootpadScreen() {
  const adc1Data = useLiveMetric(liveSelectors.footpadAdc1)
  const adc2Data = useLiveMetric(liveSelectors.footpadAdc2)
  const adc1Threshold = useFootpadThreshold(0)
  const adc2Threshold = useFootpadThreshold(1)
  const posiSensor = usePosiSensor()
  const windowMs = useLiveWindowMs()

  const charts = useMemo(() => {
    const first = toChartSeries(adc1Data, windowMs)
    const second = toChartSeries(adc2Data, windowMs)
    const firstLines = thresholdLines(adc1Threshold)
    const secondLines = thresholdLines(adc2Threshold)
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
    <ControlDetailLayout
      title="Footpad"
      gauge={
        <View style={styles.padWrap}>
          <FootpadIndicator
            adc1={liveTelemetryRuntime.values.adc1}
            adc2={liveTelemetryRuntime.values.adc2}
            posi={posiSensor}
            threshold1={adc1Threshold}
            threshold2={adc2Threshold}
            width={132}
            showValues
            testID="footpad-detail-indicator"
          />
        </View>
      }
    >
      <LiveChartStack charts={charts} />
      <BoardConfigSection rows={FOOTPAD_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}

const styles = StyleSheet.create({
  padWrap: {
    alignItems: 'center',
    paddingVertical: 20,
  },
})
