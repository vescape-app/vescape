import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { useRouter } from 'expo-router'
import { ArrowLeftIcon } from 'phosphor-react-native'
import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { ChartStack } from '@/components/charts/line/ChartStack'
import { stackChromeHeight } from '@/components/charts/line/chartLayout'
import { theme } from '@/constants/theme'
import { HistoryMetricTabs } from '@/modules/history/components/HistoryMetricTabs'
import {
  ALL_CHART_METRICS,
  toggleOptionalChartMetric,
  type ChartToggleMetric,
} from '@/modules/history/components/historyChartMetrics'
import {
  useChartExclusionBands,
  useChartRanges,
  useChartSeries,
  useChartTimeline,
  useExtraChartRanges,
  useExtraChartSeries,
  useFavoriteBands,
  useGpsGapBands,
  useHistoryChartStack,
  useMetricRamps,
  useVisibleRideSamples,
} from '@/modules/history/hooks/useHistoryChartData'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'
import { useFavoriteStore } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'

const TAB_COLUMNS = 7
const MIN_METRIC_HEIGHT = 24

export function HistoryChartsScreen() {
  useRenderRateWarning('HistoryChartsScreen')
  const { formatRideMeta, formatRideTime } = useRideFormat()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const session = useHistoryStore((s) => s.selectedSession)
  const samples = useHistoryStore((s) => s.sessionSamples)
  const gpsSamples = useHistoryStore((s) => s.sessionGpsSamples)
  const favorites = useFavoriteStore((s) => s.favorites)
  const [activeCharts, setActiveCharts] = useState<Set<ChartToggleMetric>>(
    () => new Set(ALL_CHART_METRICS.map((metric) => metric.key)),
  )
  const [stackHeight, setStackHeight] = useState(0)
  const [initialZoom] = useState(() => zoomWindowMs.value)

  const visibleSamples = useVisibleRideSamples(
    samples,
    session?.movingStartAtMs ?? null,
    session?.movingEndAtMs ?? null,
  )
  const series = useChartSeries(visibleSamples, activeCharts)
  const extraSeries = useExtraChartSeries(visibleSamples, gpsSamples)
  const timeline = useChartTimeline(visibleSamples)
  const ranges = useChartRanges(series, activeCharts)
  const extraRanges = useExtraChartRanges(extraSeries)
  const ramps = useMetricRamps()
  const exclusionBands = useChartExclusionBands()
  const favoriteBands = useFavoriteBands(favorites)
  const gpsGapBands = useGpsGapBands(visibleSamples)

  const chartCount = Math.max(1, activeCharts.size)
  const chartHeight = useMemo(() => {
    const plotSpace = Math.max(0, stackHeight - stackChromeHeight(chartCount))
    return Math.max(MIN_METRIC_HEIGHT, plotSpace / chartCount)
  }, [chartCount, stackHeight])

  const charts = useHistoryChartStack({
    series,
    ranges,
    ramps,
    exclusionBands,
    activeMetrics: activeCharts,
    speedOptional: true,
    extraSeries,
    extraRanges,
    gpsGapBands,
    speedHeight: chartHeight,
    metricHeight: chartHeight,
  })

  const handleToggleMetric = useCallback((metric: ChartToggleMetric) => {
    setActiveCharts((prev) => toggleOptionalChartMetric(prev, metric))
  }, [])

  const hasChartData = visibleSamples.length >= 2

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeftIcon}
          onPress={() => router.back()}
          size="sm"
          testID="history-charts-close"
          accessibilityLabel="Back"
        />
        <View style={styles.headerText}>
          {session ? (
            <>
              <Text style={styles.title} numberOfLines={1}>
                {formatRideTime(session.startAtMs, session.endAtMs)}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {formatRideMeta(session.startAtMs, session.endAtMs, session.boardName)}
              </Text>
            </>
          ) : null}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View
        style={styles.stack}
        onLayout={(e) => setStackHeight(e.nativeEvent.layout.height)}
        testID="history-charts-stack"
      >
        {hasChartData && stackHeight > 0 ? (
          <ChartStack
            charts={charts}
            bands={favoriteBands}
            timeline={timeline}
            dataKey={`${session?.startAtMs ?? 0}`}
            timeMode="clock"
            initialZoomMs={initialZoom}
            showHead
          />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.subtitle}>No telemetry for this ride.</Text>
          </View>
        )}
      </View>

      <HistoryMetricTabs
        activeCharts={activeCharts}
        onToggle={handleToggleMetric}
        metrics={ALL_CHART_METRICS}
        columns={TAB_COLUMNS}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
    paddingHorizontal: 8,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 38,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
  },
  stack: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
