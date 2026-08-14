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
import { formatRideMeta, formatRideTime } from '@/modules/history/lib/rideFormat'
import { useFavoriteStore } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'

/** Tabs per row: the fourteen metrics wrap into two even rows. */
const TAB_COLUMNS = 7
/**
 * Floor under a plot, below which a line is a smear rather than a reading.
 *
 * Low on purpose: this page opens with every metric on, and a rider who wants one of them taller
 * switches the others off. Shrinking to fit is what keeps that first screen honest — a taller
 * floor would push the last charts off the bottom instead.
 */
const MIN_METRIC_HEIGHT = 24

/**
 * A ride's charts with the map out of the way.
 *
 * Same stack and same data as the ride panel, opened on the same stretch: {@link zoomWindowMs} is
 * a module singleton, so whatever the rider pinched into over the map is what this page opens on.
 * It is read and never written — the panel's camera keeps owning the window the map is framed to,
 * so zooming here cannot leave the map showing a stretch the panel is no longer on.
 * What changes is the room: every chart gets a share of the whole screen rather than a strip over
 * a map, and metrics the map could never be coloured by (attitude, footpad voltage, the GPS fix)
 * are offered here because here they cost nothing.
 */
export function HistoryChartsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const session = useHistoryStore((s) => s.selectedSession)
  const samples = useHistoryStore((s) => s.sessionSamples)
  const gpsSamples = useHistoryStore((s) => s.sessionGpsSamples)
  const favorites = useFavoriteStore((s) => s.favorites)
  // Opens with everything on: the page exists to show the whole ride at once, and the tabs are
  // there to take metrics away rather than to hunt for them.
  const [activeCharts, setActiveCharts] = useState<Set<ChartToggleMetric>>(
    () => new Set(ALL_CHART_METRICS.map((metric) => metric.key)),
  )
  const [stackHeight, setStackHeight] = useState(0)
  // The window the ride panel was showing when the rider opened this page. Read once: from here
  // on the two stacks share the same shared value, and re-reading it would fight their gestures.
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
  const stackBands = useMemo(() => [...favoriteBands, ...gpsGapBands], [favoriteBands, gpsGapBands])

  // Charts are sized to fill the screen rather than to a fixed strip, so the plot heights come
  // from what the stack was actually given: the canvas spends the rest on labels and the time axis.
  const chartCount = Math.max(1, activeCharts.size)
  // Every chart gets the same plot height, speed included: the stack reads as one grid, and a
  // taller speed plot only made the metrics under it harder to compare against each other.
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
                {formatRideMeta(session.startAtMs, session.endAtMs, session.deviceName)}
              </Text>
            </>
          ) : null}
        </View>
        {/* Mirrors the back button's width so the title centers on the screen, not the gap. */}
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
            bands={stackBands}
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
    backgroundColor: theme.palette.slate.bg,
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
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.palette.slate.textSecondary,
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
