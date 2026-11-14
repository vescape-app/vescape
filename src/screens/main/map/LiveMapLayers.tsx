import { FillLayer, LineLayer, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { useEffect } from 'react'
import { processColor } from 'react-native'

import { useInMapLayer } from '@/components/map/inMapLayer'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'
import {
  RiderPresencePin,
  LiveRiderSignalPins,
  RiderTrail,
} from '@/modules/group-ride/components/RiderMapLayers'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { coinShadowAlpha, GpsPuck } from '@/modules/map/components/GpsPuck'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { puckLayerChannel } from '@/modules/map/lib/nativePuck'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

export function LiveMapLayers({
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  puckBearing,
  mapPose,
  riders,
  highContrastRoutes,
}: {
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
  const puckLng = accuracyFix?.longitude
  const puckLat = accuracyFix?.latitude
  const puckLight = useThemeStore((state) => state.resolvedTheme === 'light')
  const { layer: puckLayer, view: puckView } = useInMapLayer()
  // Places the layer puck, on the map that has the layer.
  useEffect(() => {
    if (!puckLayer) return
    if (puckLng == null || puckLat == null) {
      puckLayerChannel.setPlacement(null)
      return
    }
    const color = processColor(gpsPointColor)
    puckLayerChannel.setPlacement({
      lngLat: [puckLng, puckLat],
      color: typeof color === 'number' ? color : 0,
      shadowAlpha: coinShadowAlpha(puckLight),
    })
  }, [puckLayer, puckLng, puckLat, gpsPointColor, puckLight])
  useEffect(() => {
    if (puckLayer) return () => puckLayerChannel.setPlacement(null)
  }, [puckLayer])
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
                style={{ fillColor: processColor(accuracyFillColor) as never }}
              />
            </ShapeSource>
          )}
          {puckView && (
            <MarkerView coordinate={[accuracyFix.longitude, accuracyFix.latitude]} allowOverlap>
              <GpsPuck color={gpsPointColor} bearing={puckBearing} mapPose={mapPose} />
            </MarkerView>
          )}
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
      <LiveRiderSignalPins />
    </>
  )
}
