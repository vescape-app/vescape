import { use, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { ChartGestureHint } from '@/components/charts/ChartGestureHint'
import { ChartLoadingOverlay } from '@/components/charts/ChartLoadingOverlay'
import { ChartStack } from '@/components/charts/line/ChartStack'
import { FocusedSeriesHeader } from '@/modules/board/components/FocusedSeriesHeader'
import type { LiveChartSpec } from '@/modules/board/components/metricDetailData'
import { MetricDetailAlertContext } from '@/modules/board/components/metricDetailAlertContext'
import { FOCUS_DEFER_MS } from '@/modules/board/hooks/useLiveMetric'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useDeferredMount } from '@/hooks/useDeferredMount'

interface LiveChartStackProps {
  charts: LiveChartSpec[]
  /**
   * Cursor shared with something outside the stack — the BMS cell card reads it to show the
   * groups as they were under the finger. Charts of one stack already scrub together.
   */
  scrubTimeMs?: SharedValue<number | null>
}

/**
 * The chart stack of a `/control` detail screen.
 *
 * Live counterpart to the history stack: same camera, same scrub, but fed by the focused series
 * and cut to the rider's live window. The stack is the unit here rather than the chart — a
 * screen showing pitch, roll and balance is one gesture over all three, so a finger anywhere
 * reads the same moment on every line.
 */
export function LiveChartStack({ charts, scrubTimeMs }: LiveChartStackProps) {
  const alerts = use(MetricDetailAlertContext)
  // The series is opened on the same deferral (see `useLiveMetric`), so until it lands the stack
  // renders its chrome with no points and says so. Only a connected board will ever fill it —
  // without one an empty stack is the honest end state, not a pending one.
  const ready = useDeferredMount(FOCUS_DEFER_MS)
  const connected = useBleStore((s) => s.status === 'connected')
  const hasPoints = charts.some((chart) => chart.series.some((series) => series.data.ts.length > 0))
  const loading = connected && (!ready || !hasPoints)

  // Identity of what is on screen, so the camera resets when the rider opens a different metric
  // and survives the once-a-second arrival of new samples.
  const dataKey = charts.map((chart) => chart.key).join('|')

  // A lone chart is already named by the screen it is on; a stack needs to say which line is
  // which, so labels are the stack's business rather than each caller's.
  const labelled = charts.length > 1

  const specs = useMemo(
    () =>
      charts.map(({ controlId, ...chart }) => {
        const spec = labelled ? chart : { ...chart, label: undefined }
        return alerts && controlId === alerts.controlId
          ? { ...spec, thresholds: alerts.thresholds }
          : spec
      }),
    [alerts, charts, labelled],
  )

  return (
    <View style={styles.container}>
      <FocusedSeriesHeader />
      <ChartStack
        charts={specs}
        dataKey={dataKey}
        timeMode="relative"
        follow
        showHead
        scrubTimeMs={scrubTimeMs}
      />
      <ChartGestureHint />
      {loading ? <ChartLoadingOverlay /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The heading names the charts; it should not sit on top of the first plot line.
    gap: 12,
  },
})
