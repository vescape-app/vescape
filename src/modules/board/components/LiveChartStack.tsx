import { useUserPreferences } from '@/hooks/useUserPreferences'
import { presentLiveChart } from '@/modules/board/components/metricDetailData'
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
  scrubTimeMs?: SharedValue<number | null>
}

export function LiveChartStack({ charts, scrubTimeMs }: LiveChartStackProps) {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
  const alerts = use(MetricDetailAlertContext)
  const ready = useDeferredMount(FOCUS_DEFER_MS)
  const connected = useBleStore((s) => s.status === 'connected')
  const hasPoints = charts.some((chart) => chart.series.some((series) => series.data.ts.length > 0))
  const loading = connected && (!ready || !hasPoints)

  const dataKey = charts.map((chart) => chart.key).join('|')

  const labelled = charts.length > 1

  const specs = useMemo(
    () =>
      charts.map(({ controlId, ...chart }) => {
        const presented = presentLiveChart(chart, distanceUnit, temperatureUnit)
        const spec = labelled ? presented : { ...presented, label: undefined }
        return alerts && controlId === alerts.controlId
          ? { ...spec, thresholds: alerts.thresholds }
          : spec
      }),
    [alerts, charts, labelled, distanceUnit, temperatureUnit],
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
    gap: 12,
  },
})
