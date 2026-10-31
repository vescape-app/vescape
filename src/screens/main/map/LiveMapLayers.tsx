import { startPointAnimation } from '@/modules/map/lib/liveMotion/pointAnimation'
import { CircleLayer, FillLayer, Images, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useEffect, useRef, useState } from 'react'
import {
  createSpring,
  stepSpring,
  retargetSpring,
  springSettled,
  nearestBearingTarget,
} from '@/modules/map/lib/cameraEngine/springs'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { processColor } from 'react-native'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

const GPS_HEADING_ICON_ID = 'center-gps-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

export function LiveMapLayers({
  pointAnimator,
  displayRuntime,
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  gpsHeadingMode,
  gpsPuckBearingDeg,
  riders,
  highContrastRoutes,
}: {
  pointAnimator: MainMapLayersProps['pointAnimator']
  displayRuntime: MainMapLayersProps['displayRuntime']
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  accuracyShape: MainMapLayersProps['accuracyShape']
  gpsHeadingMode: MainMapLayersProps['gpsHeadingMode']
  gpsPuckBearingDeg: MainMapLayersProps['gpsPuckBearingDeg']
  riders: MainMapLayersProps['riders']
  highContrastRoutes: boolean
}) {
  useEffect(
    () =>
      startPointAnimation({
        motion: displayRuntime.motion,
        subscribe: displayRuntime.subscribe,
        now: displayRuntime.now,
        isActive: () => displayRuntime.active,
        moveTo: (coordinate, durationMs) =>
          pointAnimator.moveTo({ coordinate, durationMs: displayRuntime.duration(durationMs) }),
        schedule: (callback, ms) => setTimeout(callback, displayRuntime.duration(ms)),
        cancel: clearTimeout,
      }),
    [displayRuntime, pointAnimator],
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
  const [pointHeading, setPointHeading] = useState<number | null>(gpsPuckBearingDeg)
  const arrowRef = useRef<SymbolLayer>(null)
  const initialArrow = useRef(gpsPuckBearingDeg ?? 0)
  useEffect(() => {
    // Compass owns the only arrow in the other orientations. Stop GPS rotation as well as
    // removing its layer, including when a mode switch leaves a retained travel bearing.
    if (!gpsHeadingMode) return
    let spring = createSpring(initialArrow.current)
    let frame: number | null = null
    let last = performance.now()
    const animate = (now: number) => {
      frame = null
      if (!displayRuntime.active) return
      spring = stepSpring(
        spring,
        useLiveMotionSettings.getState().config.arrowHeadingOmega,
        Math.min(0.064, (now - last) / 1000),
      )
      last = now
      initialArrow.current = spring.x
      arrowRef.current?.setNativeProps({ style: { iconRotate: spring.x } })
      if (!springSettled(spring, 0.05, 0.05)) frame = requestAnimationFrame(animate)
    }
    const update = () => {
      if (!displayRuntime.active) {
        if (frame != null) cancelAnimationFrame(frame)
        frame = null
        return
      }
      const heading = displayRuntime.motion.pointHeading(displayRuntime.now())
      if (heading == null) return
      setPointHeading((previous) => previous ?? heading)
      const target = nearestBearingTarget(spring.x, heading)
      if (target === spring.target && springSettled(spring, 0.05, 0.05)) return
      spring = retargetSpring(spring, target)
      if (frame == null) {
        last = performance.now()
        frame = requestAnimationFrame(animate)
      }
    }
    const unsubscribe = displayRuntime.subscribe(update)
    update()
    return () => {
      unsubscribe()
      if (frame != null) cancelAnimationFrame(frame)
    }
  }, [displayRuntime, gpsHeadingMode])

  return (
    <>
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
      {/* Stable anchor: lines arriving after GPS acquisition must still stay below the rider. */}
      {pointAnimator && (
        <ShapeSource id="center-gps-puck-position-source" shape={pointAnimator}>
          <CircleLayer
            id={MAP_DEFAULTS.userPositionLayerId}
            style={{
              circleRadius: 8,
              circleOpacity: accuracyFix ? 1 : 0,
              circleStrokeOpacity: accuracyFix ? 1 : 0,
              circleColor: gpsPointColor,
              circleStrokeColor: theme.palette.mono.white,
              circleStrokeWidth: 3,
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
          {gpsHeadingMode && pointHeading != null && (
            <>
              <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
              <ShapeSource id="center-gps-puck-heading-source" shape={pointAnimator}>
                <SymbolLayer
                  ref={arrowRef}
                  id="center-gps-puck-heading-outline"
                  aboveLayerID={MAP_DEFAULTS.userPositionLayerId}
                  style={{
                    iconImage: GPS_HEADING_ICON_ID,
                    iconRotate: pointHeading,
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
