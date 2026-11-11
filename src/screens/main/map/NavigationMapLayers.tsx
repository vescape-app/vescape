import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native'
import { WarningIcon } from 'phosphor-react-native'
import { useMemo } from 'react'
import Animated, { withTiming } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { useResolvedNeutralColors, useResolvedColor } from '@/hooks/useTheme'
import { MapTargetReticle } from '@/modules/map/components/MapTargetReticle'
import { MapPin } from '@/modules/map/components/MapPin'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { useMapStore } from '@/modules/map/store/mapStore'
import { navigationPathShape } from '@/modules/map/lib/navigationPath'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

/**
 * Route line when the rider has not picked a colour of their own — the same purple the watch draws.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `NavColor`
 * @parity /watch/watchos/Palette.swift `nav`
 */
export const NAVIGATION_ROUTE_COLOR = theme.map.user

/** The dark halo the dots sit on, so a light path stays readable over a satellite tile. */
const NAVIGATION_CASING_WIDTH = MAP_DEFAULTS.navigationWidth + 4

/** Distance between two dot centres, in screen pixels. Fixed, so both layers dot in step. */
const NAVIGATION_DOT_SPACING_PX = 11

/**
 * A dotted line: a zero-length dash under a round cap draws a circle, and the gap does the spacing.
 *
 * MapLibre measures a dash pattern in multiples of the line's own width, so the same pattern on the
 * casing would space its dots wider than the line's. Dividing by the width converts the spacing back
 * to pixels and keeps the two layers dot for dot.
 */
function navigationDots(lineWidth: number): [number, number] {
  return [0, NAVIGATION_DOT_SPACING_PX / lineWidth]
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

function PendingNavigationTargetPin({
  coordinate,
  color,
}: {
  coordinate: [number, number]
  color: string
}) {
  return (
    <Marker lngLat={coordinate}>
      <Animated.View entering={pendingNavigationTargetEntering}>
        <MapTargetReticle color={color} />
      </Animated.View>
    </Marker>
  )
}

function getNavigationTargetIcon(target: MapSelection | null) {
  if (target?.type === 'place') return getPlaceCategoryIcon(target.category)
  return getMapPointKindIcon('direction')
}

/** The computed path, the Direction Point pin, and the not-yet-confirmed target pin. */
export function NavigationMapLayers({
  directionPoint,
  activeNavigationTarget,
  selectedNavigationTarget,
  directionColor,
  directionTextColor,
  routeColor,
  onFocusDirectionPoint,
}: {
  directionPoint: MainMapLayersProps['directionPoint']
  activeNavigationTarget: MainMapLayersProps['activeNavigationTarget']
  selectedNavigationTarget: MainMapLayersProps['selectedNavigationTarget']
  directionColor: string
  directionTextColor: string
  routeColor: string
  onFocusDirectionPoint: MainMapLayersProps['onFocusDirectionPoint']
}) {
  const neutral = useResolvedNeutralColors()
  // Native computes and owns the Navigation; this only draws the coordinates it was handed. They
  // already arrive as GeoJSON `[longitude, latitude]`, so nothing is reordered here.
  const navigation = useMapStore((state) => state.navigation)
  // No path could be computed. The pin stays exactly where the rider put it — it is still their
  // Direction Point, with a bearing and a distance — but it stops pretending a route is coming.
  const navigationFailed = navigation != null && navigation.status !== 'ready'
  const progress = useMapStore((state) => state.routeProgress)
  const showConnector = useNavigationDiagnosticsStore((state) => state.showProjectionConnector)
  // Subscribed only while the connector is on: otherwise every GPS fix would re-render the layers.
  const gpsFix = useNavigationDiagnosticsStore((state) =>
    state.showProjectionConnector ? state.gpsFix : null,
  )
  const navigationShape = useMemo(
    () => navigationPathShape(navigation, progress),
    [navigation, progress],
  )
  const connector =
    showConnector && progress && gpsFix
      ? {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [gpsFix.longitude, gpsFix.latitude],
              [progress.longitude, progress.latitude],
            ],
          },
          properties: {},
        }
      : null

  const showDirectionPoint = directionPoint != null && activeNavigationTarget?.type !== 'mapPoint'
  const pinColor = useResolvedColor(navigationFailed ? theme.status.warning.color : directionColor)
  const pinTextColor = navigationFailed ? theme.status.warning.text : directionTextColor
  const pinIcon = navigationFailed ? WarningIcon : getNavigationTargetIcon(activeNavigationTarget)

  return (
    <>
      {showDirectionPoint && navigationShape && (
        // Passed and remaining sections are split at native's projection, see navigationPath.ts.
        <GeoJSONSource id="center-navigation-source" data={navigationShape} lineMetrics>
          <Layer
            type="line"
            id="center-navigation-casing"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-opacity': ['get', 'opacity'],
              'line-color': theme.alpha(neutral.surfaceDeep, 0.85),
              'line-width': NAVIGATION_CASING_WIDTH,
              'line-dasharray': navigationDots(NAVIGATION_CASING_WIDTH),
            }}
          />
          <Layer
            type="line"
            id="center-navigation-line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-opacity': ['get', 'opacity'],
              'line-color': routeColor,
              'line-width': MAP_DEFAULTS.navigationWidth,
              'line-dasharray': navigationDots(MAP_DEFAULTS.navigationWidth),
            }}
          />
        </GeoJSONSource>
      )}
      {connector && showDirectionPoint && (
        <GeoJSONSource id="navigation-projection-source" data={connector}>
          <Layer
            type="line"
            id="navigation-projection-line"
            paint={{ 'line-color': routeColor, 'line-opacity': 0.8, 'line-width': 3 }}
          />
        </GeoJSONSource>
      )}
      {showDirectionPoint && (
        <MapPin
          id="center-direction-position"
          coordinate={[directionPoint.longitude, directionPoint.latitude]}
          color={pinColor}
          icon={pinIcon}
          iconColor={pinTextColor}
          selected
          navigationActive
          onSelected={onFocusDirectionPoint}
        />
      )}
      {selectedNavigationTarget && selectedNavigationTarget.type !== 'mapPoint' ? (
        <PendingNavigationTargetPin
          key={`center-selected-navigation-target-${selectedNavigationTarget.id}`}
          coordinate={[selectedNavigationTarget.longitude, selectedNavigationTarget.latitude]}
          color={directionColor}
        />
      ) : null}
    </>
  )
}
