import { Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { memo, useEffect, useRef } from 'react'

import { theme } from '@/constants/theme'
import { useAppActive } from '@/hooks/useAppActive'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'

import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

const GPS_HEADING_ICON_ID = 'center-phone-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

interface PhoneHeadingMapLayerProps {
  active: boolean
  /** Compass source. The caller picks it so a replay can supply the recorded stream instead. */
  followCamera: boolean
  coordinate: { longitude: number; latitude: number } | null
  /** Called with each compass heading while the camera follows the phone. */
  onFollowHeading: (headingDeg: number) => void
  onHeadingChange: (headingDeg: number | null) => void
  onStatusChange: (status: PhoneHeadingStatus | 'idle') => void
}

/**
 * The cone's on-screen angle is the heading minus the camera bearing. While the camera follows the
 * heading those two are the same number, but they reach the map by different routes — the bearing
 * through `setCameraDirect`, the icon through a shape update — and land a frame apart, so a
 * continuously moving heading leaves the cone wobbling a few degrees around the puck. Following
 * means the answer is a constant: pin the icon to the viewport pointing up and the skew cannot
 * show. Only a camera that is not tracking the heading needs the map-space bearing.
 */
function phoneHeadingShape(
  coordinate: PhoneHeadingMapLayerProps['coordinate'],
  headingDeg: number | null,
  followCamera: boolean,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features:
      coordinate && headingDeg != null
        ? [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [coordinate.longitude, coordinate.latitude],
              },
              properties: { bearing: followCamera ? 0 : headingDeg },
            },
          ]
        : [],
  }
}

export const PhoneHeadingMapLayer = memo(function PhoneHeadingMapLayer({
  active,
  followCamera,
  coordinate,
  onFollowHeading,
  onHeadingChange,
  onStatusChange,
}: PhoneHeadingMapLayerProps) {
  // The compass exists to be looked at: nothing records it, and no native work depends on it. A
  // backgrounded app kept the sensor running at 60 Hz and kept retargeting the camera spring
  // against a map nobody could see, and the retargets came due all at once on unlock.
  const appActive = useAppActive()
  const subscribed = active && appActive
  const sourceRef = useRef<ShapeSource>(null)
  const headingDegRef = useRef<number | null>(null)
  const coordinateRef = useRef(coordinate)
  const followCameraRef = useRef(followCamera)
  // The callbacks the map hands down change identity as the rider moves — the tracked-point list
  // they close over is rebuilt every metre. Reading them through refs keeps the sensor
  // subscription tied to `active` alone, instead of restarting DeviceMotion several times a
  // second mid-ride.
  const onFollowHeadingRef = useRef(onFollowHeading)
  const onHeadingChangeRef = useRef(onHeadingChange)
  const onStatusChangeRef = useRef(onStatusChange)
  onFollowHeadingRef.current = onFollowHeading
  onHeadingChangeRef.current = onHeadingChange
  onStatusChangeRef.current = onStatusChange

  useEffect(() => {
    coordinateRef.current = coordinate
    followCameraRef.current = followCamera
    sourceRef.current?.setNativeProps({
      id: 'center-phone-heading-source',
      shape: JSON.stringify(phoneHeadingShape(coordinate, headingDegRef.current, followCamera)),
    })
  }, [coordinate, followCamera])

  useEffect(() => {
    if (!subscribed) {
      headingDegRef.current = null
      onHeadingChangeRef.current(null)
      onStatusChangeRef.current('idle')
      sourceRef.current?.setNativeProps({
        id: 'center-phone-heading-source',
        shape: JSON.stringify(phoneHeadingShape(null, null, false)),
      })
      return
    }

    let disposed = false
    let remove: (() => void) | null = null

    void startPhoneHeadingUpdates(deviceMotionPhoneHeadingAdapter, (rawHeadingDeg) => {
      if (disposed) return
      const headingDeg = deadBandPhoneHeading(headingDegRef.current, rawHeadingDeg)
      if (headingDeg === headingDegRef.current) return

      headingDegRef.current = headingDeg
      onHeadingChangeRef.current(headingDeg)

      if (followCameraRef.current) {
        // The cone is pinned to the viewport while following, so its shape does not depend on the
        // heading — see `phoneHeadingShape`. Rewriting the source per sample re-serialized and
        // re-tiled a feature collection that had not changed, sixty times a second, in the one mode
        // where the main thread is already the scarce resource.
        onFollowHeadingRef.current(headingDeg)
        return
      }

      sourceRef.current?.setNativeProps({
        id: 'center-phone-heading-source',
        shape: JSON.stringify(phoneHeadingShape(coordinateRef.current, headingDeg, false)),
      })
    }).then((subscription) => {
      if (disposed) {
        subscription.remove()
        return
      }
      remove = subscription.remove
      onStatusChangeRef.current(subscription.status)
    })

    return () => {
      disposed = true
      remove?.()
    }
  }, [subscribed])

  return (
    <>
      <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
      <ShapeSource
        ref={sourceRef}
        id="center-phone-heading-source"
        shape={phoneHeadingShape(coordinate, headingDegRef.current, followCamera)}
      >
        <SymbolLayer
          id="center-phone-heading-outline"
          style={{
            iconImage: GPS_HEADING_ICON_ID,
            iconRotate: ['get', 'bearing'],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconRotationAlignment: followCamera ? 'viewport' : 'map',
            iconSize: 0.95,
            iconOffset: [0, -10],
            iconColor: theme.palette.mono.white,
          }}
        />
      </ShapeSource>
    </>
  )
})
