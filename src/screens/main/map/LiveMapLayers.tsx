import { CircleLayer, FillLayer, Images, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useMemo } from 'react'
import type { GpsDisplayAnimator } from '@/modules/map/hooks/useGpsDisplayAnimator'
import { processColor } from 'react-native'

import { theme } from '@/constants/theme'
import { usePuckHeadingSpring } from '@/modules/map/hooks/usePuckHeadingSpring'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'
import { liveTrailParts } from '@/modules/map/lib/liveTrailPrefix'
import { useLocationStore } from '@/modules/location/store/locationStore'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

const GPS_HEADING_ICON_ID = 'center-gps-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

export function LiveMapLayers({
  liveTrailShape,
  accuracyFix,
  positionAnimator,
  accuracyShape,
  gpsPuckBearingDeg,
  riders,
  highContrastRoutes,
}: {
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  positionAnimator: GpsDisplayAnimator | null
  accuracyShape: MainMapLayersProps['accuracyShape']
  gpsPuckBearingDeg: MainMapLayersProps['gpsPuckBearingDeg']
  riders: MainMapLayersProps['riders']
  highContrastRoutes: boolean
}) {
  const { layerRef: gpsHeadingLayerRef } = usePuckHeadingSpring(gpsPuckBearingDeg)
  const showRawGps = useNavigationDiagnosticsStore((s) => s.showRawGps)
  const rawFix = useLocationStore((state) => state.latestRawLocation)
  // @platform-diff Phone adds a detached two-segment dust fade; watch keeps its full-path gradient.
  const { body: trailBodyShape, tail: tailShape } = useMemo(
    () => liveTrailParts(liveTrailShape, rawFix),
    [liveTrailShape, rawFix],
  )
  const rawGpsShape = useMemo(
    () =>
      rawFix
        ? ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [rawFix.longitude, rawFix.latitude] },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.Point>)
        : null,
    [rawFix],
  )
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
      {trailBodyShape && (
        <ShapeSource id="center-live-trail-source" shape={trailBodyShape} lineMetrics>
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
      {tailShape && (
        <ShapeSource id="center-live-trail-tail-source" shape={tailShape} lineMetrics>
          <LineLayer
            id="center-live-trail-tail-line"
            style={{
              lineColor: trailGradientEnd,
              lineGradient: [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0,
                trailGradientEnd,
                1,
                trailGradientStart,
              ],
              lineWidth: MAP_DEFAULTS.trailWidth,
              lineCap: 'round',
              lineJoin: 'round',
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
            <ShapeSource
              id="center-gps-puck-position-source"
              shape={positionAnimator ?? gpsPuckPositionShape}
            >
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
              <ShapeSource
                id="center-gps-puck-heading-source"
                shape={positionAnimator ?? gpsPuckShape}
              >
                <SymbolLayer
                  ref={gpsHeadingLayerRef}
                  id="center-gps-puck-heading-outline"
                  style={{
                    iconImage: GPS_HEADING_ICON_ID,
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
      {showRawGps && rawGpsShape && (
        <ShapeSource id="center-raw-gps-source" shape={rawGpsShape}>
          <CircleLayer
            id="center-raw-gps-ring"
            style={{
              circleRadius: 13,
              circleColor: 'transparent',
              circleStrokeWidth: 2,
              circleStrokeColor: accents.amber.color,
              circlePitchAlignment: 'viewport',
            }}
          />
        </ShapeSource>
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
