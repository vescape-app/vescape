import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type TelemetryChartPoint } from '@/components/charts/chartMath'
import { TelemetryLineChart, type ChartTrimConfig } from '@/components/charts/TelemetryLineChart'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import {
  OPTIONAL_CHART_METRICS,
  SPEED_CHART_DEF,
  toggleOptionalChartMetric,
  type OptionalChartMetric,
} from '@/modules/history/components/historyChartMetrics'
import { HistoryMetricLegend } from '@/modules/history/components/HistoryMetricLegend'
import { HistoryMetricTabs } from '@/modules/history/components/HistoryMetricTabs'
import { HistoryPanelNav } from '@/modules/history/components/HistoryPanelNav'
import { HistoryRideMediaDrawer } from '@/modules/history/components/HistoryRideMediaDrawer'
import {
  useChartExcludedRanges,
  useChartRanges,
  useChartSeries,
  useMetricPointColors,
  useOptionalChartConfig,
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
  /** When set, the primary chart becomes a Favorite range trimmer and scrubbing is suspended. */
  trim?: ChartTrimConfig
}

const MAP_SEEK_THROTTLE_MS = 33

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
  const scrubTimeMs = useSharedValue<number | null>(null)
  const lastMapSeekAtRef = useRef(0)

  const { visibleSamples, chartSamples, headSample } = useVisibleRideSamples(
    samples,
    movingStartAtMs,
    movingEndAtMs,
    headTimeMs,
  )
  const series = useChartSeries(chartSamples)
  const ranges = useChartRanges(series)
  const pointColors = useMetricPointColors()
  const excludedRanges = useChartExcludedRanges()
  const optionalChartConfig = useOptionalChartConfig({
    headSample,
    chartSamples,
    series,
    ranges,
    pointColors,
    excludedRanges,
  })
  const favoriteChartHighlights = useMemo(
    () =>
      favoriteRanges.map((range) => ({
        ...range,
        color: theme.alpha(theme.status.favorite.color, 0.12),
      })),
    [favoriteRanges],
  )

  const rideWindow = rideMovingWindow({ movingStartAtMs, movingEndAtMs })
  const titleStartMs = rideWindow?.startMs ?? startAtMs
  const titleEndMs = rideWindow?.endMs ?? endAtMs
  const bottomInset = Math.max(insets.bottom, 16) + 8
  const hasChartData = headSample != null && visibleSamples.length >= 2

  const handleScrubTimeChange = useCallback(
    (timeMs: number) => {
      const now = Date.now()
      if (now - lastMapSeekAtRef.current < MAP_SEEK_THROTTLE_MS) return
      lastMapSeekAtRef.current = now
      onSeek?.(timeMs)
    },
    [onSeek],
  )

  const handlePointSelected = useCallback(
    (point: TelemetryChartPoint) => {
      const ms = point.date.getTime()
      setHeadTimeMs(ms)
      onSeek?.(ms)
    },
    [onSeek],
  )

  const handleToggleMetric = useCallback(
    (metric: OptionalChartMetric) => {
      onMetricInteraction?.(metric)
      setActiveCharts((prev) => toggleOptionalChartMetric(prev, metric))
    },
    [onMetricInteraction],
  )

  const headPoint: TelemetryChartPoint | null = headSample
    ? { date: new Date(headSample.capturedAtMs), value: headSample.speedKmh }
    : null

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
      {hasChartData && headPoint && optionalChartConfig && headSample != null && (
        <>
          <TelemetryLineChart
            label={SPEED_CHART_DEF.label}
            value={SPEED_CHART_DEF.formatValue(headSample.speedKmh)}
            points={series.speed}
            color={SPEED_CHART_DEF.color}
            range={ranges.speed}
            currentPoint={headPoint}
            height={48}
            containerStyle={styles.chart}
            timeMode="clock"
            formatValue={SPEED_CHART_DEF.formatValue}
            getPointColor={pointColors.speed}
            onGestureStart={() => onMetricInteraction?.('speed')}
            onPointSelected={trim ? undefined : handlePointSelected}
            scrubTimeMs={scrubTimeMs}
            onScrubTimeChange={trim ? undefined : handleScrubTimeChange}
            excludedRanges={excludedRanges.speed}
            timeRangeHighlights={favoriteChartHighlights}
            trim={trim}
          />

          {OPTIONAL_CHART_METRICS.filter((m) => activeCharts.has(m.key)).map((metric) => {
            const cfg = optionalChartConfig[metric.key]
            return (
              <TelemetryLineChart
                key={metric.key}
                label={cfg.label}
                value={cfg.value}
                points={cfg.points}
                color={cfg.color}
                range={cfg.range}
                currentPoint={{ date: new Date(headSample.capturedAtMs), value: cfg.headValue }}
                height={40}
                containerStyle={styles.chart}
                timeMode="clock"
                formatValue={cfg.formatValue}
                getPointColor={cfg.getPointColor}
                onGestureStart={() => onMetricInteraction?.(metric.key)}
                onPointSelected={trim ? undefined : handlePointSelected}
                scrubTimeMs={scrubTimeMs}
                onScrubTimeChange={trim ? undefined : handleScrubTimeChange}
                excludedRanges={cfg.excludedRanges}
                secondary={cfg.secondary}
              />
            )
          })}

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
    minHeight: 72,
  },
})
