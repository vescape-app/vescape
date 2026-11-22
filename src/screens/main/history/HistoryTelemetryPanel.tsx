import { useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CHART_CHANGE_FADE_MS, ChartStack } from '@/components/charts/line/ChartStack'
import { stackChromeHeight } from '@/components/charts/line/chartLayout'
import { routes } from '@/navigation/routes'
import type { ChartTimeRange } from '@/components/charts/line/types'
import { InfoModal } from '@/components/modals/InfoModal'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import {
  isHistoryMetricKey,
  PANEL_CHART_METRICS,
  toggleOptionalChartMetric,
  topActiveChartMetric,
  type ChartToggleMetric,
} from '@/modules/history/components/historyChartMetrics'
import { HistoryMetricLegend } from '@/modules/history/components/HistoryMetricLegend'
import { HistoryMetricTabs } from '@/modules/history/components/HistoryMetricTabs'
import { HistoryPanelNav } from '@/modules/history/components/HistoryPanelNav'
import { HistoryRideMediaDrawer } from '@/modules/history/components/HistoryRideMediaDrawer'
import {
  useChartExclusionBands,
  useChartRanges,
  useChartTimeline,
  useChartSeries,
  useHistoryChartStack,
  useFavoriteBands,
  useGpsGapBands,
  useMetricRamps,
  useVisibleRideSamples,
} from '@/modules/history/hooks/useHistoryChartData'
import type { MediaAssetInput, MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
import { peakSpeedAtMs, scrubHeadMs, zoomWindowMs } from '@/modules/history/lib/chartFocus'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import { rideMovingWindow } from '@/modules/history/lib/sessions'
import { useHistoryStore, type TelemetrySample } from '@/modules/history/store/historyStore'

const EMPTY_SAMPLES: TelemetrySample[] = []
const CHART_HEIGHT_DURATION_MS = 180

interface HistoryTelemetryPanelProps {
  startAtMs: number
  endAtMs: number
  movingStartAtMs: number | null
  movingEndAtMs: number | null
  boardName: string
  navigationTitle?: string
  navigationSubtitle?: string
  gpsGapSamples: TelemetrySample[]
  samples: TelemetrySample[]
  canPrevious: boolean
  canNext: boolean
  favoriteMode: boolean
  favoriteRanges: { startMs: number; endMs: number }[]
  favorited: boolean
  actionDisabled: boolean
  mediaAssets: MediaHistoryAsset[]
  mediaUnmatched: MediaAssetInput[]
  mediaLoading: boolean
  mediaError: string | null
  listButtonRef: RefObject<View | null>
  onPrevious: () => void
  onNext: () => void
  onOpenList: () => void
  onAddMedia: () => void
  onOpenMedia: (asset: MediaAssetInput) => void
  onToggleFavorite: () => void
  onMetricInteraction?: (metric: HistoryMetricKey) => void
  onHeightChange?: (height: number) => void
  trim?: HistoryTrimConfig
}

export interface HistoryTrimConfig {
  startMs: number
  endMs: number
  onChange: (startMs: number, endMs: number) => void
  onCommit: (startMs: number, endMs: number) => void
}

export const HistoryTelemetryPanel = memo(function HistoryTelemetryPanel({
  startAtMs,
  endAtMs,
  movingStartAtMs,
  movingEndAtMs,
  boardName,
  navigationTitle,
  navigationSubtitle,
  gpsGapSamples,
  samples,
  canPrevious,
  canNext,
  favoriteMode,
  favoriteRanges,
  favorited,
  actionDisabled,
  mediaAssets,
  mediaUnmatched,
  mediaLoading,
  mediaError,
  listButtonRef,
  onPrevious,
  onNext,
  onOpenList,
  onAddMedia,
  onOpenMedia,
  onToggleFavorite,
  onMetricInteraction,
  onHeightChange,
  trim,
}: HistoryTelemetryPanelProps) {
  useRenderRateWarning('HistoryTelemetryPanel')
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [activeCharts, setActiveCharts] = useState<Set<ChartToggleMetric>>(
    () => new Set<ChartToggleMetric>(['speed']),
  )
  const [displayedCharts, setDisplayedCharts] = useState(activeCharts)
  const [shareInfoVisible, setShareInfoVisible] = useState(false)
  const [mediaDrawerVisible, setMediaDrawerVisible] = useState(false)
  const mediaButtonRef = useRef<View>(null)
  const chartHeightAnimatingRef = useRef(false)
  const pendingPanelHeightRef = useRef<number | null>(null)
  const selection = useSharedValue<ChartTimeRange | null>(null)
  const trimRef = useRef(trim)
  trimRef.current = trim
  const trimming = trim != null

  const loadingSession = useHistoryStore((s) => s.loadingSession)

  const rideSamples = loadingSession ? EMPTY_SAMPLES : samples
  const rideGpsGapSamples = loadingSession ? EMPTY_SAMPLES : gpsGapSamples

  const fade = useSharedValue(1)
  useEffect(() => {
    fade.value = withTiming(loadingSession ? 0 : 1, { duration: loadingSession ? 90 : 260 })
  }, [fade, loadingSession])
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }))

  const visibleSamples = useVisibleRideSamples(rideSamples, movingStartAtMs, movingEndAtMs)
  const visibleGpsGapSamples = useVisibleRideSamples(
    rideGpsGapSamples,
    movingStartAtMs,
    movingEndAtMs,
  )
  useEffect(() => {
    setDisplayedCharts((current) => new Set([...current, ...activeCharts]))
    const timeout = setTimeout(() => setDisplayedCharts(activeCharts), CHART_CHANGE_FADE_MS)
    return () => clearTimeout(timeout)
  }, [activeCharts])

  const series = useChartSeries(visibleSamples, displayedCharts)
  const timeline = useChartTimeline(visibleSamples)
  const ranges = useChartRanges(series, displayedCharts)
  const ramps = useMetricRamps()
  const exclusionBands = useChartExclusionBands()
  const favoriteBands = useFavoriteBands(favoriteRanges)
  const gpsGapBands = useGpsGapBands(visibleGpsGapSamples)

  const charts = useHistoryChartStack({
    series,
    ranges,
    ramps,
    exclusionBands,
    activeMetrics: displayedCharts,
    speedOptional: true,
    gpsGapBands,
  })
  const chartViewportTargetHeight =
    charts.length === 0
      ? 0
      : Math.max(
          76,
          charts.reduce((height, chart) => height + chart.height, 0) +
            stackChromeHeight(charts.length),
        )
  const chartViewportHeight = useSharedValue(chartViewportTargetHeight)
  useEffect(() => {
    chartHeightAnimatingRef.current = true
    chartViewportHeight.value = withTiming(chartViewportTargetHeight, {
      duration: CHART_HEIGHT_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    })
    const timeout = setTimeout(() => {
      chartHeightAnimatingRef.current = false
      const height = pendingPanelHeightRef.current
      if (height != null) onHeightChange?.(height)
    }, CHART_HEIGHT_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [chartViewportHeight, chartViewportTargetHeight, onHeightChange])
  const chartViewportStyle = useAnimatedStyle(() => ({ height: chartViewportHeight.value }))

  const handlePanelLayout = useCallback(
    (height: number) => {
      const roundedHeight = Math.round(height)
      pendingPanelHeightRef.current = roundedHeight
      if (!chartHeightAnimatingRef.current) onHeightChange?.(roundedHeight)
    },
    [onHeightChange],
  )

  const rideWindow = rideMovingWindow({ movingStartAtMs, movingEndAtMs })
  const titleStartMs = rideWindow?.startMs ?? startAtMs
  const titleEndMs = rideWindow?.endMs ?? endAtMs
  const bottomInset = Math.max(insets.bottom, 16) + 8

  useEffect(() => {
    scrubHeadMs.value = null
    zoomWindowMs.value = null
    return () => {
      scrubHeadMs.value = null
      zoomWindowMs.value = null
    }
  }, [startAtMs])

  const sessionFocus = useHistoryStore((s) => s.sessionFocus)
  useEffect(() => {
    if (sessionFocus == null || visibleGpsGapSamples.length === 0) return
    useHistoryStore.getState().clearSessionFocus()
    const focusMs = sessionFocus === 'topSpeed' ? peakSpeedAtMs(visibleGpsGapSamples) : null
    if (focusMs != null) scrubHeadMs.value = focusMs
  }, [sessionFocus, visibleGpsGapSamples])

  const trimStartMs = trim?.startMs
  const trimEndMs = trim?.endMs
  useEffect(() => {
    selection.value =
      trimStartMs == null || trimEndMs == null ? null : { startMs: trimStartMs, endMs: trimEndMs }
  }, [selection, trimEndMs, trimStartMs])

  useAnimatedReaction(
    () => (trimming ? selection.value : null),
    (range) => {
      zoomWindowMs.value = range == null ? null : { startMs: range.startMs, endMs: range.endMs }
    },
    [trimming],
  )

  useEffect(() => {
    if (!trimming) zoomWindowMs.value = null
  }, [trimming])

  const handleSelectionPreview = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onChange(range.startMs, range.endMs)
  }, [])

  const handleSelectionCommit = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onCommit(range.startMs, range.endMs)
  }, [])

  const handleChartTouch = useCallback(
    (key: string) => {
      if (isHistoryMetricKey(key)) onMetricInteraction?.(key)
    },
    [onMetricInteraction],
  )

  const handleToggleMetric = useCallback(
    (metric: ChartToggleMetric) => {
      const next = toggleOptionalChartMetric(activeCharts, metric)
      setActiveCharts(next)
      const colourBy = next.has(metric) ? metric : topActiveChartMetric(next)
      if (colourBy != null && isHistoryMetricKey(colourBy)) onMetricInteraction?.(colourBy)
    },
    [activeCharts, onMetricInteraction],
  )

  return (
    <View
      style={[styles.panel, { bottom: bottomInset }]}
      onLayout={(e) => handlePanelLayout(e.nativeEvent.layout.height)}
    >
      {!trim ? (
        <HistoryPanelNav
          titleStartMs={titleStartMs}
          titleEndMs={titleEndMs}
          boardName={boardName}
          title={navigationTitle}
          subtitle={navigationSubtitle}
          canPrevious={canPrevious}
          canNext={canNext}
          favoriteMode={favoriteMode}
          favorited={favorited}
          actionDisabled={actionDisabled}
          mediaCount={mediaAssets.length + mediaUnmatched.length}
          mediaLoading={mediaLoading}
          mediaButtonRef={mediaButtonRef}
          listButtonRef={listButtonRef}
          onPrevious={onPrevious}
          onNext={onNext}
          onOpenList={onOpenList}
          onOpenMediaDrawer={() => setMediaDrawerVisible(true)}
          onToggleFavorite={onToggleFavorite}
          onOpenShareInfo={() => setShareInfoVisible(true)}
          onOpenCharts={() => router.push(routes.historyCharts)}
        />
      ) : null}
      <Animated.View style={[styles.chartViewport, chartViewportStyle, fadeStyle]}>
        {displayedCharts.size > 0 ? (
          <View style={styles.chartContent}>
            <ChartStack
              charts={charts}
              bands={favoriteBands}
              timeline={timeline}
              dataKey={`${startAtMs}`}
              timeMode="clock"
              containerStyle={styles.chart}
              scrubTimeMs={scrubHeadMs}
              zoomWindowMs={trimming ? undefined : zoomWindowMs}
              selection={trim ? selection : undefined}
              onSelectionPreview={handleSelectionPreview}
              onSelectionChange={handleSelectionCommit}
              onChartTouch={trim ? undefined : handleChartTouch}
              showHead
              animateChartChanges
              visibleChartKeys={activeCharts}
            />
          </View>
        ) : null}
      </Animated.View>

      <HistoryMetricTabs
        activeCharts={activeCharts}
        onToggle={handleToggleMetric}
        metrics={PANEL_CHART_METRICS}
      />
      <HistoryMetricLegend />
      {favoriteMode ? (
        <HistoryRideMediaDrawer
          visible={mediaDrawerVisible}
          triggerRef={mediaButtonRef}
          assets={mediaAssets}
          unmatched={mediaUnmatched}
          loading={mediaLoading}
          error={mediaError}
          onClose={() => setMediaDrawerVisible(false)}
          onAdd={onAddMedia}
          onOpenMedia={onOpenMedia}
        />
      ) : null}
      <InfoModal
        visible={shareInfoVisible}
        title="Share Ride"
        message="Ride sharing is coming in the future."
        onDismiss={() => setShareInfoVisible(false)}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 20,
    gap: 8,
  },
  chart: {
    minHeight: 76,
  },
  chartViewport: {
    overflow: 'hidden',
  },
  chartContent: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
  },
})
