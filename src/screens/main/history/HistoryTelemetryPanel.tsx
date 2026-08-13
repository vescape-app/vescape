import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ChartStack } from '@/components/charts/line/ChartStack'
import type { ChartTimeRange } from '@/components/charts/line/types'
import { InfoModal } from '@/components/modals/InfoModal'
import {
  toggleOptionalChartMetric,
  type OptionalChartMetric,
} from '@/modules/history/components/historyChartMetrics'
import { HistoryMetricLegend } from '@/modules/history/components/HistoryMetricLegend'
import { HistoryMetricTabs } from '@/modules/history/components/HistoryMetricTabs'
import { HistoryPanelNav } from '@/modules/history/components/HistoryPanelNav'
import { HistoryRideMediaDrawer } from '@/modules/history/components/HistoryRideMediaDrawer'
import {
  useChartExclusionBands,
  useChartRanges,
  useChartSeries,
  useHistoryChartStack,
  useMetricRamps,
  useVisibleRideSamples,
} from '@/modules/history/hooks/useHistoryChartData'
import type { MediaAssetInput, MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
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
  onSeek?: (timeMs: number) => void
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
  onSeek,
  onMetricInteraction,
  onHeightChange,
  trim,
}: HistoryTelemetryPanelProps) {
  const insets = useSafeAreaInsets()
  const [headTimeMs, setHeadTimeMs] = useState<number | null>(null)
  const [activeCharts, setActiveCharts] = useState<Set<OptionalChartMetric>>(new Set())
  const [shareInfoVisible, setShareInfoVisible] = useState(false)
  const [mediaDrawerVisible, setMediaDrawerVisible] = useState(false)
  const mediaButtonRef = useRef<View>(null)
  const selection = useSharedValue<ChartTimeRange | null>(null)
  const trimRef = useRef(trim)
  trimRef.current = trim

  const { visibleSamples, headSample } = useVisibleRideSamples(
    samples,
    movingStartAtMs,
    movingEndAtMs,
    headTimeMs,
  )
  const series = useChartSeries(visibleSamples)
  const ranges = useChartRanges(series)
  const ramps = useMetricRamps()
  const exclusionBands = useChartExclusionBands()
  const charts = useHistoryChartStack({
    headSample,
    series,
    ranges,
    ramps,
    exclusionBands,
    favoriteRanges,
    activeMetrics: activeCharts,
  })

  const rideWindow = rideMovingWindow({ movingStartAtMs, movingEndAtMs })
  const titleStartMs = rideWindow?.startMs ?? startAtMs
  const titleEndMs = rideWindow?.endMs ?? endAtMs
  const bottomInset = Math.max(insets.bottom, 16) + 8
  const hasChartData = headSample != null && visibleSamples.length >= 2

  // The seed range enters the canvas as a shared value, so dragging a handle never renders the
  // panel; the trimmer hears about it through the throttled callbacks below.
  const trimStartMs = trim?.startMs
  const trimEndMs = trim?.endMs
  useEffect(() => {
    selection.value =
      trimStartMs == null || trimEndMs == null ? null : { startMs: trimStartMs, endMs: trimEndMs }
  }, [selection, trimEndMs, trimStartMs])

  const handleScrubTimeChange = useCallback(
    (timeMs: number | null) => {
      if (timeMs == null || trimRef.current) return
      setHeadTimeMs(timeMs)
      onSeek?.(timeMs)
    },
    [onSeek],
  )

  const handleSelectionPreview = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onChange(range.startMs, range.endMs)
  }, [])

  const handleSelectionCommit = useCallback((range: ChartTimeRange) => {
    trimRef.current?.onCommit(range.startMs, range.endMs)
  }, [])

  const handleToggleMetric = useCallback(
    (metric: OptionalChartMetric) => {
      onMetricInteraction?.(metric)
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
        />
      ) : null}
      {hasChartData && (
        <>
          <ChartStack
            charts={charts}
            dataKey={`${startAtMs}`}
            timeMode="clock"
            containerStyle={styles.chart}
            onScrubTimeChange={trim ? undefined : handleScrubTimeChange}
            selection={trim ? selection : undefined}
            onSelectionPreview={handleSelectionPreview}
            onSelectionChange={handleSelectionCommit}
            showHead
          />

          <HistoryMetricTabs activeCharts={activeCharts} onToggle={handleToggleMetric} />
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
