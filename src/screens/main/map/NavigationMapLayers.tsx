import { LineLayer, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { WarningIcon } from 'phosphor-react-native'
import { useMemo } from 'react'
import Animated, { withTiming } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { MapTargetReticle } from '@/modules/map/components/MapTargetReticle'
import { MapPin } from '@/modules/map/components/MapPin'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'
import { getPlaceCategoryIconKey } from '@/modules/map-points/constants/placeCategoryIcon'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { useMapStore } from '@/modules/map/store/mapStore'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

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

/** The computed path, the Direction Point pin, and the not-yet-confirmed target pin. */
export function NavigationMapLayers({
  directionPoint,
  activeNavigationTarget,
  selectedNavigationTarget,
  directionColor,
  directionTextColor,
  onFocusDirectionPoint,
}: {
  directionPoint: MainMapLayersProps['directionPoint']
  activeNavigationTarget: MainMapLayersProps['activeNavigationTarget']
  selectedNavigationTarget: MainMapLayersProps['selectedNavigationTarget']
  directionColor: string
  directionTextColor: string
  onFocusDirectionPoint: MainMapLayersProps['onFocusDirectionPoint']
}) {
  const neutral = useResolvedNeutralColors()
  // Native computes and owns the Navigation; this only draws the coordinates it was handed. They
  // already arrive as GeoJSON `[longitude, latitude]`, so nothing is reordered here.
  const navigation = useMapStore((state) => state.navigation)
  // No path could be computed. The pin stays exactly where the rider put it — it is still their
  // Direction Point, with a bearing and a distance — but it stops pretending a route is coming.
  const navigationFailed = navigation != null && navigation.status !== 'ready'
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

  const showDirectionPoint = directionPoint != null && activeNavigationTarget?.type !== 'mapPoint'
  const pinColor = navigationFailed ? theme.status.warning.color : directionColor
  const pinTextColor = navigationFailed ? theme.status.warning.text : directionTextColor
  const pinIcon = navigationFailed ? WarningIcon : getNavigationTargetIcon(activeNavigationTarget)

  return (
    <>
      {showDirectionPoint &&
        navigationShape && (
          // Drawn whole, never trimmed or dimmed as the rider advances — deliberate, see #353.
          // `lineMetrics` is free now and is what a later dimming pass would need.
          <ShapeSource id="center-navigation-source" shape={navigationShape} lineMetrics>
            <LineLayer
              id="center-navigation-casing"
              style={{
                lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
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
          key={`center-direction-position-${pinColor}-${navigationFailed ? 'failed' : getNavigationTargetIconKey(activeNavigationTarget)}`}
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
