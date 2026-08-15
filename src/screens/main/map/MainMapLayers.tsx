import {
  CircleLayer,
  FillExtrusionLayer,
  FillLayer,
  Images,
  LineLayer,
  MarkerView,
  RasterLayer,
  RasterSource,
  ShapeSource,
  SymbolLayer,
} from '@rnmapbox/maps'
import { WarningIcon } from 'phosphor-react-native'
import { useEffect, useMemo, useState } from 'react'
import { processColor } from 'react-native'
import Animated, { withTiming } from 'react-native-reanimated'
import type { MapPoint, MapPointCategory } from 'vescape-core'

import { useMapStore, type DirectionPoint } from '@/modules/map/store/mapStore'

import { MediaHistoryPin } from '@/modules/history/components/MediaHistoryPin'
import { PrivacyZonesMapLayer } from '@/modules/history/components/PrivacyZonesMapLayer'
import { RouteZoomFocus } from '@/screens/main/map/RouteZoomFocus'
import { SeekPositionPin } from '@/screens/main/map/SeekPositionPin'
import { MapPin } from '@/modules/map/components/MapPin'
import { MapTargetReticle } from '@/modules/map/components/MapTargetReticle'
import { RainViewerOverlay } from '@/modules/weather/components/RainViewerOverlay'
import { MAPY_TILE_URL_TEMPLATE } from '@/config/mapy'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'
import {
  getMapPointKindColor,
  getMapPointKindLabel,
  getMapPointKindTextColor,
} from '@/modules/map-points/constants/mapPoints'
import { theme } from '@/constants/theme'
import {
  useResolvedAccentColors,
  useResolvedNeutralColors,
  useResolvedTelemetryColors,
} from '@/hooks/useTheme'
import { makeCircleFeature, makeTrailLineString } from '@/helpers/mapGeometry'
import { getFavoriteRouteSegments } from '@/modules/history/lib/favoriteRoute'
import { resolveMarkerRenderData } from '@/modules/history/lib/markerOverlap'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import {
  clusterMediaHistoryAssets,
  MEDIA_CLUSTER_DISTANCE_M,
  type MediaHistoryAsset,
} from '@/modules/history/lib/mediaHistory'
import type {
  HistoryMetricKey,
  HistoryMetricHotRanges,
} from '@/modules/history/lib/metricColorScale'
import { isMapPinKindVisible } from '@/modules/map-points/lib/mapPointVisibility'
import { getPlaceCategoryIconKey } from '@/modules/map-points/constants/placeCategoryIcon'
import type {
  HistoryGpsSample,
  HistoryMarker,
  TelemetrySample,
} from '@/modules/history/store/historyStore'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

import {
  HISTORY_MARKER_COLORS,
  HISTORY_MARKER_ICONS,
  type SelectedHistoryMarker,
} from '@/modules/history/lib/historyMapMarkerInfo'
import {
  DESTINATION_POINT_COLOR,
  DESTINATION_POINT_TEXT_COLOR,
} from '@/screens/main/map/offscreenMapIndicators'
import {
  getHistoryMetricBaseColor,
  getHistoryRouteHighlightDurationMs,
  getHistoryRouteHighlightGradient,
  getHistoryRouteMetricGradient,
} from '@/modules/history/lib/historyRouteGradient'
import type { LegalLimitCountry } from '@/modules/legal/lib/legalLimits'
import { LegalLimitsMapLayer } from '@/modules/legal/components/LegalLimitsMapLayer'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { rosterRiderColor } from '@/modules/group-ride/lib/riderColor'

const GPS_HEADING_ICON_ID = 'center-gps-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')
const HISTORY_ROUTE_HIGHLIGHT_INTERVAL_MS = 50
const HISTORY_ROUTE_HIGHLIGHT_DELAY_MS = 500

/** The dark halo the dots sit on, so a light path stays readable over a satellite tile. */
const NAVIGATION_CASING_WIDTH = MAP_DEFAULTS.navigationWidth + 4

/** Distance between two dot centres, in screen pixels. Fixed, so both layers dot in step. */
const NAVIGATION_DOT_SPACING_PX = 11

/**
 * A dotted line: a zero-length dash under a round cap draws a circle, and the gap does the spacing.
 *
 * Mapbox measures a dash pattern in multiples of the line's own width, so the same pattern on the
 * casing would space its dots wider than the line's. Dividing by the width converts the spacing back
 * to pixels and keeps the two layers dot for dot.
 */
function navigationDots(lineWidth: number): [number, number] {
  return [0, NAVIGATION_DOT_SPACING_PX / lineWidth]
}
interface MainMapLayersProps {
  historyActive: boolean
  expandSelectedMapPoints: boolean
  isMapy: boolean
  isOneDark: boolean
  isSatellite: boolean
  showBuildings3d: boolean
  weatherActive: boolean
  legalLimitsActive: boolean
  liveTrailShape: ReturnType<typeof makeTrailLineString> | null
  rideRouteShape: {
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    properties: Record<string, never>
  } | null
  accuracyFix: { longitude: number; latitude: number } | null
  accuracyShape: ReturnType<typeof makeCircleFeature> | null
  gpsPuckBearingDeg: number | null
  riders: RosterRider[]
  rideRoute: [number, number][]
  rideTelemetrySamples: TelemetrySample[]
  activeHistoryMapMetric: HistoryMetricKey
  rideMarkers: HistoryMarker[]
  rideGpsSamples: HistoryGpsSample[]
  mediaAssets: MediaHistoryAsset[]
  favoriteRanges: { startMs: number; endMs: number }[]
  mapZoom: number
  historyMetricGradientsEnabled: boolean
  historyMetricHotRanges: HistoryMetricHotRanges
  directionPoint: DirectionPoint | null
  activeNavigationTarget: MapSelection | null
  selectedNavigationTarget: MapSelection | null
  mapPoints: MapPoint[]
  selectedMapPointId: string | null
  hiddenMapPointCategories: MapPointCategory[]
  onToggleMapPointSelection: (id: string) => void
  onSuppressNextMapPress: () => void
  onSelectMarker: (selection: SelectedHistoryMarker) => void
  onOpenMedia: (asset: MediaHistoryAsset) => void
  onSelectLegalCountry: (country: LegalLimitCountry) => void
  onFocusDirectionPoint: () => void
}

function LiveMapLayers({
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  gpsPuckBearingDeg,
  riders,
  highContrastRoutes,
}: {
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  accuracyShape: MainMapLayersProps['accuracyShape']
  gpsPuckBearingDeg: MainMapLayersProps['gpsPuckBearingDeg']
  riders: MainMapLayersProps['riders']
  highContrastRoutes: boolean
}) {
  const riderColor = useRiderStore((state) => state.riderColor)
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const gpsPointColor = riderColor ?? accents.purple.color
  const trailColor = riderColor ?? accents.violet.color
  const trailGradientStart = riderColor
    ? theme.alpha(riderColor, 0)
    : theme.alpha(accents.violet.color, 0)
  const trailGradientEnd = riderColor
    ? theme.alpha(riderColor, 0.85)
    : theme.alpha(accents.violet.color, 0.85)
  const accuracyFillColor = theme.alpha(accents.violet.color, 0.12)
  const gpsPuckPositionShape = useMemo(
    () =>
      accuracyFix
        ? ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [accuracyFix.longitude, accuracyFix.latitude],
            },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.Point>)
        : null,
    [accuracyFix],
  )
  const gpsPuckShape = useMemo(
    () =>
      accuracyFix && gpsPuckBearingDeg != null
        ? ({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [accuracyFix.longitude, accuracyFix.latitude],
                },
                properties: { bearing: gpsPuckBearingDeg },
              },
            ],
          } as GeoJSON.FeatureCollection)
        : null,
    [accuracyFix, gpsPuckBearingDeg],
  )

  return (
    <>
      {liveTrailShape && (
        <ShapeSource id="center-live-trail-source" shape={liveTrailShape} lineMetrics>
          <LineLayer
            id="center-live-trail-casing"
            style={{
              lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
              lineWidth: highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="center-live-trail-line"
            style={{
              lineColor: trailColor,
              lineWidth: MAP_DEFAULTS.trailWidth,
              lineCap: 'round',
              lineJoin: 'round',
              lineGradient: [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0,
                trailGradientStart,
                1,
                trailGradientEnd,
              ],
            }}
          />
        </ShapeSource>
      )}
      {accuracyFix && (
        <>
          {accuracyShape && (
            <ShapeSource id="center-gps-accuracy-source" shape={accuracyShape}>
              <FillLayer
                id="center-gps-accuracy-fill"
                style={{ fillColor: processColor(accuracyFillColor) as never }}
              />
            </ShapeSource>
          )}
          {gpsPuckPositionShape && (
            <ShapeSource id="center-gps-puck-position-source" shape={gpsPuckPositionShape}>
              <CircleLayer
                id="center-gps-puck-core"
                style={{
                  circleRadius: 8,
                  circleColor: gpsPointColor,
                  circleStrokeColor: theme.palette.mono.white,
                  circleStrokeWidth: 3,
                }}
              />
            </ShapeSource>
          )}
          {gpsPuckShape && (
            <>
              <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
              <ShapeSource id="center-gps-puck-heading-source" shape={gpsPuckShape}>
                <SymbolLayer
                  id="center-gps-puck-heading-outline"
                  style={{
                    iconImage: GPS_HEADING_ICON_ID,
                    iconRotate: ['get', 'bearing'],
                    iconAllowOverlap: true,
                    iconIgnorePlacement: true,
                    iconRotationAlignment: 'map',
                    iconSize: 0.95,
                    iconOffset: [0, -10],
                    iconColor: theme.palette.mono.white,
                  }}
                />
              </ShapeSource>
            </>
          )}
        </>
      )}
      {riders.map((rider, index) =>
        rider.trail && rider.trail.length >= 2 ? (
          <RiderTrail
            key={rider.id}
            rider={rider}
            index={index}
            highContrastRoutes={highContrastRoutes}
          />
        ) : null,
      )}
      {riders.map((rider, index) =>
        rider.presence ? <RiderPresencePin key={rider.id} rider={rider} index={index} /> : null,
      )}
    </>
  )
}

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

function PendingNavigationTargetPin({
  coordinate,
  color,
}: {
  coordinate: [number, number]
  color: string
}) {
  return (
    <MarkerView coordinate={coordinate} allowOverlap>
      <Animated.View entering={pendingNavigationTargetEntering}>
        <MapTargetReticle color={color} />
      </Animated.View>
    </MarkerView>
  )
}

function getNavigationTargetIcon(target: MapSelection | null) {
  if (target?.type === 'place') return getPlaceCategoryIcon(target.category)
  return getMapPointKindIcon('direction')
}

function getNavigationTargetIconKey(target: MapSelection | null) {
  return target?.type === 'place' ? getPlaceCategoryIconKey(target.category) : 'direction'
}

const pendingNavigationTargetEntering = () => {
  'worklet'
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 1.8 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 260 }),
      transform: [{ scale: withTiming(1, { duration: 260 }) }],
    },
  }
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
  // Flips only on trim enter/exit, so the whole-route layers dim without per-drag re-renders.
  const trimming = useMainScreenStore((s) => s.trimRange != null)
  const accents = useResolvedAccentColors()
  const telemetryColors = useResolvedTelemetryColors()
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
              lineColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
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

export function MainMapLayers({
  historyActive,
  expandSelectedMapPoints,
  isMapy,
  isOneDark,
  isSatellite,
  showBuildings3d,
  weatherActive,
  legalLimitsActive,
  liveTrailShape,
  rideRouteShape,
  accuracyFix,
  accuracyShape,
  gpsPuckBearingDeg,
  riders,
  rideRoute,
  rideTelemetrySamples,
  activeHistoryMapMetric,
  rideMarkers,
  rideGpsSamples,
  mediaAssets,
  favoriteRanges,
  mapZoom,
  historyMetricGradientsEnabled,
  historyMetricHotRanges,
  directionPoint,
  activeNavigationTarget,
  selectedNavigationTarget,
  mapPoints,
  selectedMapPointId,
  hiddenMapPointCategories,
  onToggleMapPointSelection,
  onSuppressNextMapPress,
  onSelectMarker,
  onOpenMedia,
  onSelectLegalCountry,
  onFocusDirectionPoint,
}: MainMapLayersProps) {
  const riderColor = useRiderStore((state) => state.riderColor)
  const directionColor = riderColor ?? DESTINATION_POINT_COLOR
  const selectedMapPoint = useMemo(
    () =>
      mapPoints.find(
        (point) =>
          point.id === selectedMapPointId &&
          isMapPinKindVisible(point.category, hiddenMapPointCategories),
      ) ?? null,
    [hiddenMapPointCategories, mapPoints, selectedMapPointId],
  )
  const activeNavigationMapPointId =
    activeNavigationTarget?.type === 'mapPoint' ? activeNavigationTarget.point.id : null
  const showDirectionPoint =
    directionPoint != null && activeNavigationTarget?.type !== 'mapPoint' && !historyActive

  // Native computes and owns the Navigation; this only draws the coordinates it was handed. They
  // already arrive as GeoJSON `[longitude, latitude]`, so nothing is reordered here.
  const navigation = useMapStore((state) => state.navigation)
  // No path could be computed. The pin stays exactly where the rider put it — it is still their
  // Direction Point, with a bearing and a distance — but it stops pretending a route is coming.
  const navigationFailed = navigation != null && navigation.status !== 'ready'
  const directionPinColor = navigationFailed ? theme.status.warning.color : directionColor
  const directionPinIcon = navigationFailed
    ? WarningIcon
    : getNavigationTargetIcon(activeNavigationTarget)
  const navigationShape = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(
    () =>
      navigation && navigation.coordinates.length > 1
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: navigation.coordinates },
            properties: {},
          }
        : null,
    [navigation],
  )
  const showNavigation = showDirectionPoint && navigationShape != null
  const mapObjectsInteractive = !weatherActive && !legalLimitsActive && !historyActive

  return (
    <>
      {showBuildings3d && (
        <FillExtrusionLayer
          id="center-3d-buildings"
          sourceLayerID="building"
          minZoomLevel={14}
          maxZoomLevel={22}
          style={{
            fillExtrusionColor: isOneDark ? theme.map.buildingDark : theme.map.buildingLight,
            fillExtrusionHeight: ['coalesce', ['get', 'height'], 12],
            fillExtrusionBase: ['coalesce', ['get', 'min_height'], 0],
            fillExtrusionOpacity: isOneDark ? 0.65 : 0.42,
            fillExtrusionVerticalGradient: true,
          }}
        />
      )}
      {isMapy && MAPY_TILE_URL_TEMPLATE ? (
        <RasterSource
          id="center-mapy-tiles"
          tileUrlTemplates={[MAPY_TILE_URL_TEMPLATE]}
          tileSize={256}
          maxZoomLevel={MAP_DEFAULTS.maxZoom}
        >
          <RasterLayer id="center-mapy-tiles-layer" sourceID="center-mapy-tiles" style={{}} />
        </RasterSource>
      ) : null}
      <RainViewerOverlay visible={weatherActive} />
      {legalLimitsActive ? <LegalLimitsMapLayer onSelectCountry={onSelectLegalCountry} /> : null}
      <PrivacyZonesMapLayer />
      {historyActive ? (
        <HistoryMapLayers
          rideRouteShape={rideRouteShape}
          rideRoute={rideRoute}
          rideTelemetrySamples={rideTelemetrySamples}
          activeHistoryMapMetric={activeHistoryMapMetric}
          rideMarkers={rideMarkers}
          rideGpsSamples={rideGpsSamples}
          mediaAssets={mediaAssets}
          favoriteRanges={favoriteRanges}
          mapZoom={mapZoom}
          historyMetricGradientsEnabled={historyMetricGradientsEnabled}
          historyMetricHotRanges={historyMetricHotRanges}
          onSuppressNextMapPress={onSuppressNextMapPress}
          onSelectMarker={onSelectMarker}
          onOpenMedia={onOpenMedia}
          highContrastRoutes={isSatellite}
        />
      ) : (
        <LiveMapLayers
          liveTrailShape={liveTrailShape}
          accuracyFix={accuracyFix}
          accuracyShape={accuracyShape}
          gpsPuckBearingDeg={gpsPuckBearingDeg}
          riders={riders}
          highContrastRoutes={isSatellite}
        />
      )}
      {showNavigation && (
        // Drawn whole, never trimmed or dimmed as the rider advances — deliberate, see #353.
        // `lineMetrics` is free now and is what a later dimming pass would need.
        <ShapeSource id="center-navigation-source" shape={navigationShape} lineMetrics>
          <LineLayer
            id="center-navigation-casing"
            style={{
              lineColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
              lineWidth: NAVIGATION_CASING_WIDTH,
              lineCap: 'round',
              lineJoin: 'round',
              lineDasharray: navigationDots(NAVIGATION_CASING_WIDTH),
            }}
          />
          <LineLayer
            id="center-navigation-line"
            style={{
              lineColor: directionColor,
              lineWidth: MAP_DEFAULTS.navigationWidth,
              lineCap: 'round',
              lineJoin: 'round',
              lineDasharray: navigationDots(MAP_DEFAULTS.navigationWidth),
            }}
          />
        </ShapeSource>
      )}
      {showDirectionPoint && (
        <MapPin
          // Color in the key: PointAnnotation snapshots its children natively, so a
          // rider-color or icon change must remount the pin to re-render.
          key={`center-direction-position-${directionPinColor}-${navigationFailed ? 'failed' : getNavigationTargetIconKey(activeNavigationTarget)}`}
          id="center-direction-position"
          coordinate={[directionPoint.longitude, directionPoint.latitude]}
          color={directionPinColor}
          icon={directionPinIcon}
          iconColor={
            navigationFailed
              ? theme.status.warning.text
              : (riderColor ?? DESTINATION_POINT_TEXT_COLOR)
          }
          selected
          navigationActive
          onSelected={onFocusDirectionPoint}
        />
      )}
      {selectedNavigationTarget &&
      selectedNavigationTarget.type !== 'mapPoint' &&
      !historyActive ? (
        <PendingNavigationTargetPin
          key={`center-selected-navigation-target-${selectedNavigationTarget.id}`}
          coordinate={[selectedNavigationTarget.longitude, selectedNavigationTarget.latitude]}
          color={directionColor}
        />
      ) : null}
      {!historyActive &&
        riders.map((rider, index) =>
          rider.presence?.target ? (
            <MapPin
              key={`center-rider-target-${rider.id}-${rosterRiderColor(rider, index)}`}
              id={`center-rider-target-${rider.id}`}
              coordinate={[rider.presence.target.lng, rider.presence.target.lat]}
              color={rosterRiderColor(rider, index)}
              icon={getMapPointKindIcon('direction')}
            />
          ) : null,
        )}
      {!historyActive &&
        mapPoints
          .filter((point) => isMapPinKindVisible(point.category, hiddenMapPointCategories))
          .map((point) => (
            <MapPin
              key={point.id}
              id={`center-map-point-${point.id}`}
              coordinate={[point.longitude, point.latitude]}
              color={getMapPointKindColor(point.category)}
              icon={getMapPointKindIcon(point.category)}
              iconColor={getMapPointKindTextColor(point.category)}
              selected={
                selectedMapPoint?.id === point.id || activeNavigationMapPointId === point.id
              }
              navigationActive={activeNavigationMapPointId === point.id}
              expandSelected={expandSelectedMapPoints && selectedMapPoint?.id === point.id}
              label={point.name?.trim() || getMapPointKindLabel(point.category)}
              onSelected={
                mapObjectsInteractive
                  ? () => {
                      onSuppressNextMapPress()
                      onToggleMapPointSelection(point.id)
                    }
                  : undefined
              }
            />
          ))}
    </>
  )
}
