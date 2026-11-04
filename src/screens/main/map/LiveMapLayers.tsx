import { CircleLayer, FillLayer, LineLayer, ShapeSource } from '@rnmapbox/maps'
import { processColor } from 'react-native'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { MotionPuck } from '@/modules/map/components/MotionPuck'
import { MotionComparisonLayers } from '@/modules/map/components/MotionComparisonLayers'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

export function LiveMapLayers({
  displayRuntime,
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  puckBearing,
  mapPose,
  riders,
  highContrastRoutes,
}: {
  displayRuntime: MainMapLayersProps['displayRuntime']
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  accuracyShape: MainMapLayersProps['accuracyShape']
  puckBearing: MainMapLayersProps['puckBearing']
  mapPose: MainMapLayersProps['mapPose']
  riders: MainMapLayersProps['riders']
  highContrastRoutes: boolean
}) {
  const riderColor = useSelectedBoardRailColor()
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const accuracyFillColor = theme.alpha(accents.violet.color, 0.12)
  const gpsPointColor = riderColor ?? accents.purple.color
  const trailColor = riderColor ?? accents.violet.color
  const trailGradientStart = riderColor
    ? theme.alpha(riderColor, 0)
    : theme.alpha(accents.violet.color, 0)
  // @platform-diff Watch trail peaks at 60% opacity to separate it from the planned route.
  const trailGradientEnd = riderColor
    ? theme.alpha(riderColor, 0.85)
    : theme.alpha(accents.violet.color, 0.85)
  return (
    <>
      <MotionComparisonLayers motion={displayRuntime.motion} />
      {/* Stable ordering anchor; the visible coin is a native view annotation. */}
      <ShapeSource id="center-gps-puck-anchor" shape={{ type: 'Point', coordinates: [0, 0] }}>
        <CircleLayer
          id={MAP_DEFAULTS.userPositionLayerId}
          style={{ circleOpacity: 0, circleRadius: 0 }}
        />
      </ShapeSource>
      {liveTrailShape && (
        <ShapeSource id="center-live-trail-source" shape={liveTrailShape} lineMetrics>
          <LineLayer
            id="center-live-trail-casing"
            belowLayerID={MAP_DEFAULTS.userPositionLayerId}
            style={{
              lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
              lineWidth: highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="center-live-trail-line"
            belowLayerID={MAP_DEFAULTS.userPositionLayerId}
            style={{
              lineColor: trailColor,
              lineWidth: MAP_DEFAULTS.trailWidth,
              lineCap: 'round',
              lineJoin: 'round',
              // @parity /watch/wearos/src/main/java/app/vescape/wear/RiderTrail.kt
              // @parity /watch/watchos/RiderTrail.swift
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
                belowLayerID={MAP_DEFAULTS.userPositionLayerId}
                style={{ fillColor: processColor(accuracyFillColor) as never }}
              />
            </ShapeSource>
          )}
          <MotionPuck
            displayRuntime={displayRuntime}
            fallbackCoordinate={[accuracyFix.longitude, accuracyFix.latitude]}
            color={gpsPointColor}
            bearing={puckBearing}
            mapPose={mapPose}
          />
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
