import { LineLayer, ShapeSource } from '@rnmapbox/maps'
import { useEffect, useMemo, useState } from 'react'

import { theme } from '@/constants/theme'
import {
  useResolvedAccentColors,
  useResolvedNeutralColors,
  useResolvedTelemetryColors,
} from '@/hooks/useTheme'
import { MediaHistoryPin } from '@/modules/history/components/MediaHistoryPin'
import { getFavoriteRouteSegments } from '@/modules/history/lib/favoriteRoute'
import {
  getHistoryMetricBaseColor,
  getHistoryRouteHighlightDurationMs,
  getHistoryRouteHighlightGradient,
  getHistoryRouteMetricGradient,
} from '@/modules/history/lib/historyRouteGradient'
import {
  HISTORY_MARKER_COLORS,
  HISTORY_MARKER_ICONS,
} from '@/modules/history/lib/historyMapMarkerInfo'
import { resolveMarkerRenderData } from '@/modules/history/lib/markerOverlap'
import {
  clusterMediaHistoryAssets,
  MEDIA_CLUSTER_DISTANCE_M,
} from '@/modules/history/lib/mediaHistory'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'
import { MapPin } from '@/modules/map/components/MapPin'
import { RouteZoomFocus } from '@/screens/main/map/RouteZoomFocus'
import { SeekPositionPin } from '@/screens/main/map/SeekPositionPin'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

const HISTORY_ROUTE_HIGHLIGHT_INTERVAL_MS = 50
const HISTORY_ROUTE_HIGHLIGHT_DELAY_MS = 500

// Live sub-range highlight while trimming a Favorite. Subscribes to the trim range directly so a
// drag only re-renders this layer, not the whole map. rideGpsSamples is a stable prop.
function TrimRouteHighlight({ rideGpsSamples }: { rideGpsSamples: HistoryGpsSample[] }) {
  const accents = useResolvedAccentColors()
  const trimRange = useMainScreenStore((s) => s.trimRange)
  const shape = useMemo(() => {
    if (!trimRange) return null
    const lo = Math.min(trimRange.startMs, trimRange.endMs)
    const hi = Math.max(trimRange.startMs, trimRange.endMs)
    const coordinates: [number, number][] = []
    for (const gps of rideGpsSamples) {
      if (gps.capturedAtMs < lo) continue
      if (gps.capturedAtMs > hi) break
      coordinates.push([gps.longitude, gps.latitude])
    }
    if (coordinates.length < 2) return null
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {},
    } as const
  }, [trimRange, rideGpsSamples])

  if (!shape) return null
  return (
    <ShapeSource id="center-ride-trim-source" shape={shape}>
      <LineLayer
        id="center-ride-trim-line"
        style={{
          lineColor: accents.amber.color,
          lineWidth: 5,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  )
}

function FavoriteRouteBorder({
  rideGpsSamples,
  favoriteRanges,
  highContrastRoutes,
  trimming,
}: {
  rideGpsSamples: HistoryGpsSample[]
  favoriteRanges: MainMapLayersProps['favoriteRanges']
  highContrastRoutes: boolean
  trimming: boolean
}) {
  const accents = useResolvedAccentColors()
  const shape = useMemo(() => {
    const coordinates = getFavoriteRouteSegments(rideGpsSamples, favoriteRanges)
    if (coordinates.length === 0) return null
    return {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates },
      properties: {},
    } as const
  }, [favoriteRanges, rideGpsSamples])

  if (!shape) return null
  return (
    <ShapeSource id="center-ride-favorites-source" shape={shape}>
      <LineLayer
        id="center-ride-favorites-border"
        belowLayerID="center-ride-route-casing"
        style={{
          lineColor: accents.yellow.color,
          lineWidth: highContrastRoutes ? 10 : 6,
          lineOpacity: trimming ? 1 : 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  )
}

export function HistoryMapLayers({
  rideRouteShape,
  rideRoute,
  rideTelemetrySamples,
  activeHistoryMapMetric,
  rideMarkers,
  rideGpsSamples,
  mediaAssets,
  favoriteRanges,
  mapZoom,
  historyMetricGradientsEnabled: gradientsEnabled,
  historyMetricHotRanges: hotRanges,
  onSuppressNextMapPress,
  onSelectMarker,
  onOpenMedia,
  highContrastRoutes,
}: {
  rideRouteShape: MainMapLayersProps['rideRouteShape']
  rideRoute: MainMapLayersProps['rideRoute']
  rideTelemetrySamples: MainMapLayersProps['rideTelemetrySamples']
  activeHistoryMapMetric: MainMapLayersProps['activeHistoryMapMetric']
  rideMarkers: MainMapLayersProps['rideMarkers']
  rideGpsSamples: MainMapLayersProps['rideGpsSamples']
  mediaAssets: MainMapLayersProps['mediaAssets']
  favoriteRanges: MainMapLayersProps['favoriteRanges']
  mapZoom: MainMapLayersProps['mapZoom']
  historyMetricGradientsEnabled: MainMapLayersProps['historyMetricGradientsEnabled']
  historyMetricHotRanges: MainMapLayersProps['historyMetricHotRanges']
  onSuppressNextMapPress: MainMapLayersProps['onSuppressNextMapPress']
  onSelectMarker: MainMapLayersProps['onSelectMarker']
  onOpenMedia: MainMapLayersProps['onOpenMedia']
  highContrastRoutes: boolean
}) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const telemetryColors = useResolvedTelemetryColors()
  // Flips only on trim enter/exit, so the whole-route layers dim without per-drag re-renders.
  const trimming = useMainScreenStore((s) => s.trimRange != null)
  const [highlightProgress, setHighlightProgress] = useState(0)
  const highlightDurationMs = useMemo(
    () => getHistoryRouteHighlightDurationMs(rideRoute),
    [rideRoute],
  )

  useEffect(() => {
    if (!rideRouteShape) return
    const resetFrame = requestAnimationFrame(() => setHighlightProgress(0))
    let interval: ReturnType<typeof setInterval> | null = null
    const timeout = setTimeout(() => {
      const startedAt = Date.now()
      interval = setInterval(() => {
        const progress = (Date.now() - startedAt) / highlightDurationMs
        setHighlightProgress(Math.min(1, progress))
        if (progress >= 1 && interval) clearInterval(interval)
      }, HISTORY_ROUTE_HIGHLIGHT_INTERVAL_MS)
    }, HISTORY_ROUTE_HIGHLIGHT_DELAY_MS)
    return () => {
      cancelAnimationFrame(resetFrame)
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [highlightDurationMs, rideRouteShape])

  const routeHighlightGradient = useMemo(
    () => getHistoryRouteHighlightGradient(highlightProgress),
    [highlightProgress],
  )
  const routeMetricGradient = useMemo(
    () =>
      getHistoryRouteMetricGradient({
        gpsSamples: rideGpsSamples,
        telemetrySamples: rideTelemetrySamples,
        metric: activeHistoryMapMetric,
        hotRanges,
        gradientsEnabled,
        colors: telemetryColors,
        hotColor: accents.red.color,
      }),
    [
      accents.red.color,
      activeHistoryMapMetric,
      gradientsEnabled,
      hotRanges,
      rideGpsSamples,
      rideTelemetrySamples,
      telemetryColors,
    ],
  )
  const mediaClusters = useMemo(
    () =>
      clusterMediaHistoryAssets(
        mediaAssets,
        MEDIA_CLUSTER_DISTANCE_M * 2 ** Math.max(0, Math.min(8, 16 - mapZoom)),
      ),
    [mapZoom, mediaAssets],
  )

  return (
    <>
      <FavoriteRouteBorder
        rideGpsSamples={rideGpsSamples}
        favoriteRanges={favoriteRanges}
        highContrastRoutes={highContrastRoutes}
        trimming={trimming}
      />
      {rideRouteShape && (
        <ShapeSource id="center-ride-route-source" shape={rideRouteShape} lineMetrics>
          <LineLayer
            id="center-ride-route-casing"
            style={{
              lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
              lineWidth: highContrastRoutes ? 8 : 0,
              lineCap: 'round',
              lineJoin: 'round',
              lineOpacity: trimming ? 0.3 : 1,
            }}
          />
          <LineLayer
            id="center-ride-route-line"
            style={{
              lineColor: getHistoryMetricBaseColor(activeHistoryMapMetric, telemetryColors),
              lineWidth: highContrastRoutes ? 5 : 4,
              lineCap: 'round',
              lineJoin: 'round',
              lineOpacity: trimming ? 0.3 : 1,
              ...(routeMetricGradient ? { lineGradient: routeMetricGradient } : {}),
            }}
          />
        </ShapeSource>
      )}
      {/* Over the route, under the pins: the pins are landmarks of the whole ride and stay
          readable however far the chart is zoomed in. */}
      <RouteZoomFocus
        rideGpsSamples={rideGpsSamples}
        routeShape={rideRouteShape}
        rideTelemetrySamples={rideTelemetrySamples}
        metric={activeHistoryMapMetric}
        hotRanges={hotRanges}
        gradientsEnabled={gradientsEnabled}
        highContrastRoutes={highContrastRoutes}
      />
      {/* Its own source, above the zoom focus: the scrub glow marks where the finger is on the
          chart, which stays true whether or not that stretch is the one zoomed into. */}
      {rideRouteShape && (
        <ShapeSource id="center-ride-route-highlight-source" shape={rideRouteShape} lineMetrics>
          <LineLayer
            id="center-ride-route-highlight"
            style={{
              lineGradient: routeHighlightGradient,
              lineWidth: highContrastRoutes ? 5 : 4,
              lineCap: 'round',
              lineJoin: 'round',
              lineOpacity: trimming ? 0.3 : 1,
            }}
          />
        </ShapeSource>
      )}
      <TrimRouteHighlight rideGpsSamples={rideGpsSamples} />
      {rideRoute[0] && (
        <MapPin
          id="center-ride-start"
          coordinate={rideRoute[0]}
          color={theme.palette.green.color}
        />
      )}
      {rideRoute.at(-1) && (
        <MapPin
          id="center-ride-end"
          coordinate={rideRoute.at(-1)!}
          color={theme.status.error.color}
        />
      )}
      <SeekPositionPin rideGpsSamples={rideGpsSamples} />

      {resolveMarkerRenderData(rideMarkers, rideGpsSamples).map(
        ({ marker, gps, renderCoordinate }) => (
          <MapPin
            key={marker.id}
            id={`center-ride-marker-${marker.id}`}
            coordinate={renderCoordinate}
            color={HISTORY_MARKER_COLORS[marker.type]}
            icon={HISTORY_MARKER_ICONS[marker.type]}
            onSelected={() => {
              onSuppressNextMapPress()
              onSelectMarker({ marker, gps })
            }}
          />
        ),
      )}
      {mediaClusters.map((cluster) => (
        <MediaHistoryPin
          key={cluster.id}
          cluster={cluster}
          onPress={() => {
            onSuppressNextMapPress()
            onOpenMedia(cluster.assets[0])
          }}
        />
      ))}
    </>
  )
}
