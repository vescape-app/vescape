import { CircleLayer, FillLayer, Images, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useMemo } from 'react'

import { theme } from '@/constants/theme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { GPS_POINT_COLOR } from '@/screens/main/map/offscreenMapIndicators'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

const GPS_HEADING_ICON_ID = 'center-gps-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

export function LiveMapLayers({
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
  const gpsPointColor = riderColor ?? GPS_POINT_COLOR
  const trailColor = riderColor ?? MAP_DEFAULTS.trailColor
  const trailGradientStart = riderColor
    ? theme.alpha(riderColor, 0)
    : MAP_DEFAULTS.trailGradientStart
  const trailGradientEnd = riderColor
    ? theme.alpha(riderColor, 0.85)
    : MAP_DEFAULTS.trailGradientEnd
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
              lineColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
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
                style={{ fillColor: MAP_DEFAULTS.accuracyFillColor }}
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
