import type { GpsDisplayAnimator } from '@/modules/map/hooks/useGpsDisplayAnimator'
import { Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { usePuckHeadingSpring } from '@/modules/map/hooks/usePuckHeadingSpring'
import { memo, useEffect, useRef, useState } from 'react'

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
  coordinate: {
    longitude: number
    latitude: number
  } | null
  positionAnimator: GpsDisplayAnimator | null
  /** Called with each compass heading while the camera follows the phone. */
  onFollowHeading: (headingDeg: number) => void
  onHeadingChange: (headingDeg: number | null) => void
  onStatusChange: (status: PhoneHeadingStatus | 'idle') => void
}

function phoneHeadingShape(
  coordinate: PhoneHeadingMapLayerProps['coordinate'],
  headingDeg: number | null,
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
              properties: {},
            },
          ]
        : [],
  }
}

export const PhoneHeadingMapLayer = memo(function PhoneHeadingMapLayer({
  active,
  followCamera,
  coordinate,
  positionAnimator,
  onFollowHeading,
  onHeadingChange,
  onStatusChange,
}: PhoneHeadingMapLayerProps) {
  // The compass exists to be looked at: nothing records it, and no native work depends on it. A
  // backgrounded app kept the sensor running at 60 Hz and kept retargeting the camera spring
  // against a map nobody could see, and the retargets came due all at once on unlock.
  const appActive = useAppActive()
  const subscribed = active && appActive
  const [hasHeading, setHasHeading] = useState(false)
  const movingPositionRef = useRef(false)
  const { layerRef: headingLayerRef, setHeading } = usePuckHeadingSpring(null, subscribed)
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
    movingPositionRef.current = positionAnimator != null
    if (headingDegRef.current != null) setHeading(headingDegRef.current)
    if (positionAnimator) {
      headingLayerRef.current?.setNativeProps({
        style: {
          visibility: subscribed && headingDegRef.current != null ? 'visible' : 'none',
        },
      })
      return
    }
    sourceRef.current?.setNativeProps({
      id: 'center-phone-heading-source',
      shape: JSON.stringify(phoneHeadingShape(coordinate, headingDegRef.current)),
    })
  }, [coordinate, followCamera, positionAnimator, subscribed, setHeading, headingLayerRef])

  useEffect(() => {
    if (!subscribed) {
      headingDegRef.current = null
      setHasHeading(false)
      onHeadingChangeRef.current(null)
      onStatusChangeRef.current('idle')
      if (movingPositionRef.current) {
        headingLayerRef.current?.setNativeProps({ style: { visibility: 'none' } })
      } else
        sourceRef.current?.setNativeProps({
          id: 'center-phone-heading-source',
          shape: JSON.stringify(phoneHeadingShape(null, null)),
        })
      return
    }

    let disposed = false
    let remove: (() => void) | null = null

    void startPhoneHeadingUpdates(deviceMotionPhoneHeadingAdapter, (rawHeadingDeg) => {
      if (disposed) return
      const headingDeg = deadBandPhoneHeading(headingDegRef.current, rawHeadingDeg)
      if (headingDeg === headingDegRef.current) return

      // The first valid sensor sample makes the arrow visible.
      const hadHeading = headingDegRef.current != null
      if (!hadHeading) setHasHeading(true)
      headingDegRef.current = headingDeg
      setHeading(headingDeg)
      onHeadingChangeRef.current(headingDeg)

      if (hadHeading) {
        // Position is unchanged by a compass sample. Only the angular spring needs retargeting.
        if (followCameraRef.current) onFollowHeadingRef.current(headingDeg)
        return
      }

      if (movingPositionRef.current) {
        headingLayerRef.current?.setNativeProps({
          style: {
            visibility: 'visible',
          },
        })
      } else
        sourceRef.current?.setNativeProps({
          id: 'center-phone-heading-source',
          shape: JSON.stringify(phoneHeadingShape(coordinateRef.current, headingDeg)),
        })
      if (followCameraRef.current) onFollowHeadingRef.current(headingDeg)
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
  }, [subscribed, setHeading, headingLayerRef])

  return (
    <>
      <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
      <ShapeSource
        ref={sourceRef}
        id="center-phone-heading-source"
        shape={positionAnimator ?? phoneHeadingShape(coordinate, headingDegRef.current)}
      >
        <SymbolLayer
          ref={headingLayerRef}
          id="center-phone-heading-outline"
          style={{
            iconImage: GPS_HEADING_ICON_ID,
            // The spring owns rotation; renders preserve acquired sensor visibility.
            visibility: subscribed && hasHeading ? 'visible' : 'none',
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
  )
})
