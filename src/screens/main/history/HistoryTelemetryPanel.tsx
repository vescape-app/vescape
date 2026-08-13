import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ChartStack } from '@/components/charts/line/ChartStack'
import { routes } from '@/navigation/routes'
import type { ChartTimeRange } from '@/components/charts/line/types'
import { InfoModal } from '@/components/modals/InfoModal'
import {
  isHistoryMetricKey,
  PANEL_CHART_METRICS,
  toggleOptionalChartMetric,
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
import { scrubHeadMs, zoomWindowMs } from '@/modules/history/lib/chartFocus'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import { rideMovingWindow } from '@/modules/history/lib/sessions'
import { type TelemetrySample } from '@/modules/history/store/historyStore'

interface HistoryTelemetryPanelProps {
  startAtMs: number
  endAtMs: number
  movingStartAtMs: number | null
  movingEndAtMs: number | null
  deviceName: string
  navigationTitle?: string
  navigationSubtitle?: string
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
  /** When set, the stack becomes a Favorite range trimmer and scrubbing is suspended. */
  trim?: HistoryTrimConfig
}

/** A Favorite being cut out of the ride: the seed range, and where the rider drags it to. */
export interface HistoryTrimConfig {
  startMs: number
  endMs: number
  onChange: (startMs: number, endMs: number) => void
  onCommit: (startMs: number, endMs: number) => void
}

export function HistoryTelemetryPanel({
  startAtMs,
  endAtMs,
  movingStartAtMs,
  movingEndAtMs,
  deviceName,
  navigationTitle,
  navigationSubtitle,
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
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Speed is on by default and closable like any other line — the rider who wants the map back
  // should not have to keep a chart they are not reading.
  const [activeCharts, setActiveCharts] = useState<Set<ChartToggleMetric>>(
    () => new Set<ChartToggleMetric>(['speed']),
  )
  const [shareInfoVisible, setShareInfoVisible] = useState(false)
  const [mediaDrawerVisible, setMediaDrawerVisible] = useState(false)
  const mediaButtonRef = useRef<View>(null)
  const selection = useSharedValue<ChartTimeRange | null>(null)
  const trimRef = useRef(trim)
  trimRef.current = trim
  const trimming = trim != null

  const visibleSamples = useVisibleRideSamples(samples, movingStartAtMs, movingEndAtMs)
  const series = useChartSeries(visibleSamples)
  const timeline = useChartTimeline(visibleSamples)
  const ranges = useChartRanges(series)
  const ramps = useMetricRamps()
  const exclusionBands = useChartExclusionBands()
  const favoriteBands = useFavoriteBands(favoriteRanges)
  const gpsGapBands = useGpsGapBands(visibleSamples)
  const stackBands = useMemo(() => [...favoriteBands, ...gpsGapBands], [favoriteBands, gpsGapBands])
  const charts = useHistoryChartStack({
    series,
    ranges,
    ramps,
    exclusionBands,
    activeMetrics: activeCharts,
    speedOptional: true,
  })

  const rideWindow = rideMovingWindow({ movingStartAtMs, movingEndAtMs })
  const titleStartMs = rideWindow?.startMs ?? startAtMs
  const titleEndMs = rideWindow?.endMs ?? endAtMs
  const bottomInset = Math.max(insets.bottom, 16) + 8
  const hasChartData = visibleSamples.length >= 2

  // The scrub head and the zoom window outlive this component (the map reads both), so a ride
  // switch has to clear them — otherwise the map keeps marking a moment from the previous ride.
  useEffect(() => {
    scrubHeadMs.value = null
    zoomWindowMs.value = null
    return () => {
      scrubHeadMs.value = null
      zoomWindowMs.value = null
    }
  }, [startAtMs])

  // The seed range enters the canvas as a shared value, so dragging a handle never renders the
  // panel; the trimmer hears about it through the throttled callbacks below.
  const trimStartMs = trim?.startMs
  const trimEndMs = trim?.endMs
  useEffect(() => {
    selection.value =
      trimStartMs == null || trimEndMs == null ? null : { startMs: trimStartMs, endMs: trimEndMs }
  }, [selection, trimEndMs, trimStartMs])

  // Trimming a Favorite is the rider saying which part of the ride they mean, so the map follows
  // the handles rather than the chart's own zoom: same dim, same camera fit, same settle.
  useAnimatedReaction(
    () => (trimming ? selection.value : null),
    (range) => {
      zoomWindowMs.value = range == null ? null : { startMs: range.startMs, endMs: range.endMs }
    },
    [trimming],
  )

  // Leaving the trimmer hands the window back to the chart's camera, which only reports on its
  // next change — so the selection has to be cleared here or the map stays framed on it.
  useEffect(() => {
    if (!trimming) zoomWindowMs.value = null
  }, [trimming])

  const handleSelectionPreview = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onChange(range.startMs, range.endMs)
  }, [])

  const handleSelectionCommit = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onCommit(range.startMs, range.endMs)
  }, [])

  // Touching a chart is what says "colour the route by this": the stack keys its charts by metric,
  // and the map reads the same hot ranges the lines do, so the two always agree.
  const handleChartTouch = useCallback(
    (key: string) => {
      if (isHistoryMetricKey(key)) onMetricInteraction?.(key)
    },
    [onMetricInteraction],
  )

  const handleToggleMetric = useCallback(
    (metric: ChartToggleMetric) => {
      if (isHistoryMetricKey(metric)) onMetricInteraction?.(metric)
      setActiveCharts((prev) => toggleOptionalChartMetric(prev, metric))
    },
    [onMetricInteraction],
  )

  return (
    <View
      style={[styles.panel, { bottom: bottomInset }]}
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
    >
      {!trim ? (
        <HistoryPanelNav
          titleStartMs={titleStartMs}
          titleEndMs={titleEndMs}
          deviceName={deviceName}
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
      {hasChartData && (
        <>
          {/* Every metric closed means the rider wants the map: the tabs stay to bring one back. */}
          {activeCharts.size > 0 ? (
            <ChartStack
              charts={charts}
              bands={stackBands}
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
            />
          ) : null}

          <HistoryMetricTabs
            activeCharts={activeCharts}
            onToggle={handleToggleMetric}
            metrics={PANEL_CHART_METRICS}
          />
          <HistoryMetricLegend />
        </>
      )}
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
}

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
})
