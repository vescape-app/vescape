import { HISTORY_ENDPOINT_LAYER_ID } from '@/modules/history/lib/historyMapLayers'
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg'
import { View } from 'react-native'
import { LineLayer, PointAnnotation, PointAnnotationManager, ShapeSource } from '@rnmapbox/maps'
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
        belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
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
      {/* Create the native symbol layer before strokes that reference it for ordering. */}
      <PointAnnotationManager id={HISTORY_ENDPOINT_LAYER_ID} iconAllowOverlap iconIgnorePlacement>
        {rideRoute[0] && renderHistoryEndpointFlag(rideRoute[0], telemetryColors.duty, 'start')}
        {rideRoute.at(-1) &&
          renderHistoryEndpointFlag(rideRoute.at(-1)!, neutral.textPrimary, 'end')}
      </PointAnnotationManager>
      <FavoriteRouteBorder
        rideGpsSamples={rideGpsSamples}
        favoriteRanges={favoriteRanges}
        highContrastRoutes={highContrastRoutes}
        trimming={trimming}
      />
      {rideRouteShape && (
        <ShapeSource id="center-ride-route-source" shape={rideRouteShape} lineMetrics>
          <LineLayer
            belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
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
            belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
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
            belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
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

/**
 * Endpoint flag geometry, in SVG units with the pole's foot at the origin: a pole with a cloth at
 * its top, stroked like the app's outline icons, the cloth tinted rather than filled.
 */
const FLAG = {
  /** Screen pixels per unit. */
  scale: 1.2,
  stroke: 2.2,
  poleHeight: 28,
  /** Start pennant: how far its tip reaches and how tall it is at the pole. */
  pennant: { length: 15, height: 15 },
  /** Finish cloth, with its checks as columns × rows. */
  cloth: { width: 16, height: 12, radius: 3, columns: 4, rows: 3 },
  tintOpacity: 0.25,
  checkOpacity: 0.45,
} as const
const FLAG_PAD = FLAG.stroke / 2
const FLAG_WIDTH = FLAG.cloth.width + FLAG.stroke
const FLAG_HEIGHT = FLAG.poleHeight + FLAG.stroke
const FLAG_TOP = -FLAG.poleHeight

// PointAnnotation snapshots the flag into the map renderer, like saved Map Points.
function renderHistoryEndpointFlag(
  coordinate: [number, number],
  color: string,
  kind: 'start' | 'end',
) {
  const { cloth, pennant } = FLAG
  const outline = {
    stroke: color,
    strokeWidth: FLAG.stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const
  return (
    <PointAnnotation
      key={`history-${kind}-${color}`}
      id={`center-ride-${kind}`}
      coordinate={coordinate}
      anchor={{ x: FLAG_PAD / FLAG_WIDTH, y: (FLAG_HEIGHT - FLAG_PAD) / FLAG_HEIGHT }}
    >
      <View
        collapsable={false}
        style={{ width: FLAG_WIDTH * FLAG.scale, height: FLAG_HEIGHT * FLAG.scale }}
      >
        <Svg
          width={FLAG_WIDTH * FLAG.scale}
          height={FLAG_HEIGHT * FLAG.scale}
          viewBox={`${-FLAG_PAD} ${FLAG_TOP - FLAG_PAD} ${FLAG_WIDTH} ${FLAG_HEIGHT}`}
        >
          <Path d={`M0 0V${FLAG_TOP}`} {...outline} />
          {kind === 'start' ? (
            <Path
              d={`M0 ${FLAG_TOP}L${pennant.length} ${FLAG_TOP + pennant.height / 2}L0 ${FLAG_TOP + pennant.height}Z`}
              fill={color}
              fillOpacity={FLAG.tintOpacity}
              {...outline}
            />
          ) : (
            <>
              <Defs>
                <ClipPath id="history-flag-cloth">
                  <Rect y={FLAG_TOP} width={cloth.width} height={cloth.height} rx={cloth.radius} />
                </ClipPath>
              </Defs>
              <G clipPath="url(#history-flag-cloth)">
                {Array.from({ length: cloth.rows * cloth.columns }, (_, index) => {
                  const row = Math.floor(index / cloth.columns)
                  const column = index % cloth.columns
                  if ((row + column) % 2 !== 0) return null
                  return (
                    <Rect
                      key={index}
                      x={(column * cloth.width) / cloth.columns}
                      y={FLAG_TOP + (row * cloth.height) / cloth.rows}
                      width={cloth.width / cloth.columns}
                      height={cloth.height / cloth.rows}
                      fill={color}
                      fillOpacity={FLAG.checkOpacity}
                    />
                  )
                })}
              </G>
              <Path
                d={`M0 ${FLAG_TOP}H${cloth.width - cloth.radius}a${cloth.radius} ${cloth.radius} 0 0 1 ${cloth.radius} ${cloth.radius}v${cloth.height - 2 * cloth.radius}a${cloth.radius} ${cloth.radius} 0 0 1 ${-cloth.radius} ${cloth.radius}H0`}
                fill="none"
                {...outline}
              />
            </>
          )}
        </Svg>
      </View>
    </PointAnnotation>
  )
}
