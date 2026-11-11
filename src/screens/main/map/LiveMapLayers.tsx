import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { GpsPuck } from '@/modules/map/components/GpsPuck'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

export function LiveMapLayers({
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  puckBearing,
  mapPose,
  fillBeforeId,
  riders,
  highContrastRoutes,
}: {
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  accuracyShape: MainMapLayersProps['accuracyShape']
  puckBearing: MainMapLayersProps['puckBearing']
  mapPose: MainMapLayersProps['mapPose']
  fillBeforeId: MainMapLayersProps['fillBeforeId']
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
      {liveTrailShape && (
        <GeoJSONSource id="center-live-trail-source" data={liveTrailShape} lineMetrics>
          <Layer
            type="line"
            id="center-live-trail-casing"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': theme.alpha(neutral.surfaceDeep, 0.85),
              'line-width': highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
            }}
          />
          <Layer
            type="line"
            id="center-live-trail-line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': trailColor,
              'line-width': MAP_DEFAULTS.trailWidth,
              // @parity /watch/wearos/src/main/java/app/vescape/wear/RiderTrail.kt
              // @parity /watch/watchos/RiderTrail.swift
              'line-gradient': [
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
        </GeoJSONSource>
      )}
      {accuracyFix && (
        <>
          {accuracyShape && (
            <GeoJSONSource id="center-gps-accuracy-source" data={accuracyShape}>
              <Layer
                type="fill"
                id="center-gps-accuracy-fill"
                beforeId={fillBeforeId}
                paint={{ 'fill-color': accuracyFillColor }}
              />
            </GeoJSONSource>
          )}
          <Marker lngLat={[accuracyFix.longitude, accuracyFix.latitude]}>
            <GpsPuck color={gpsPointColor} bearing={puckBearing} mapPose={mapPose} />
          </Marker>
        </>
      )}
      {riders.map((rider) =>
        rider.trail && rider.trail.length >= 2 ? (
          <RiderTrail key={rider.id} rider={rider} highContrastRoutes={highContrastRoutes} />
        ) : null,
      )}
      {riders.map((rider) =>
        rider.presence ? <RiderPresencePin key={rider.id} rider={rider} /> : null,
      )}
    </>
  )
}
