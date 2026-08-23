import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import {
  BoardConfigSection,
  erpm,
  isEnabled,
  millis,
  onOff,
  volts,
  type BoardConfigRow,
} from '@/modules/board/components/BoardConfigSection'
import { FootpadIndicator } from '@/modules/board/components/FootpadIndicator'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
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

/**
 * What the board itself does with these two sensors: when a zone counts as engaged, how long it
 * tolerates a foot coming off, and the switches that weaken that protection.
 */
const FOOTPAD_CONFIG_ROWS: BoardConfigRow[] = [
  {
    id: 'fault_adc1',
    label: 'Zone 1 engages at',
    format: (v) => volts(v, 'Disabled'),
  },
  {
    id: 'fault_adc2',
    label: 'Zone 2 engages at',
    format: (v) => volts(v, 'Disabled'),
  },
  {
    id: 'fault_is_dual_switch',
    label: 'Both zones as one (Posi)',
    format: onOff,
    note: (v) =>
      isEnabled(v) ? 'Heel-lift dismount is off — either zone holds the board on.' : null,
  },
  {
    id: 'fault_adc_half_erpm',
    label: 'One zone off is a fault below',
    format: erpm,
  },
  {
    id: 'fault_delay_switch_half',
    label: 'One zone off, cutoff after',
    format: millis,
  },
  {
    id: 'fault_delay_switch_full',
    label: 'Both zones off, cutoff after',
    format: millis,
  },
  {
    // Refloat's own field is the negative one ("Disable Moving Faults"), so the row is named after
    // the setting rather than inverted into "Moving faults: Active" — an inverted row reads as the
    // opposite of the toggle the rider set, which is the one thing a config readout must not do.
    id: 'fault_moving_fault_disabled',
    label: 'Moving faults disabled',
    format: onOff,
    note: (v) =>
      isEnabled(v) ? 'The board will not disengage on sensors while rolling forward.' : null,
  },
  {
    id: 'fault_darkride_enabled',
    label: 'Darkride',
    format: onOff,
    note: (v) => (isEnabled(v) ? 'Riding upside down without sensors is allowed.' : null),
  },
  {
    id: 'enable_quickstop',
    label: 'Quickstop',
    format: onOff,
  },
]

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
    <ControlDetailLayout
      title="Footpad"
      gauge={
        // The same pad as the telemetry strip, at a size where each rail's fill is readable while
        // the rider shifts weight — the charts below answer "what happened", this answers "now".
        <View style={styles.padWrap}>
          <FootpadIndicator
            adc1={liveTelemetryRuntime.values.adc1}
            adc2={liveTelemetryRuntime.values.adc2}
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
