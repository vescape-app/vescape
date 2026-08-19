import { Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { memo, useEffect, useRef } from 'react'
import { recordPhoneHeading } from 'vescape-core'

import { theme } from '@/constants/theme'

import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingAdapter,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

/**
 * How often a compass reading is offered to a running Debug Recording. The sensor streams at ~60Hz;
 * a replay reproduces the ride convincingly at a fraction of that, and every sample is a bridge call
 * plus a line in the recording.
 */
const PHONE_HEADING_RECORD_INTERVAL_MS = 100

const GPS_HEADING_ICON_ID = 'center-phone-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

interface PhoneHeadingMapLayerProps {
  active: boolean
  /** Compass source. The caller picks it so a replay can supply the recorded stream instead. */
  adapter: PhoneHeadingAdapter
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
  adapter,
  followCamera,
  coordinate,
  onFollowHeading,
  onHeadingChange,
  onStatusChange,
}: PhoneHeadingMapLayerProps) {
  const sourceRef = useRef<ShapeSource>(null)
  const headingDegRef = useRef<number | null>(null)
  const coordinateRef = useRef(coordinate)
  const followCameraRef = useRef(followCamera)

  useEffect(() => {
    coordinateRef.current = coordinate
    followCameraRef.current = followCamera
    sourceRef.current?.setNativeProps({
      id: 'center-phone-heading-source',
      shape: JSON.stringify(phoneHeadingShape(coordinate, headingDegRef.current, followCamera)),
    })
  }, [coordinate, followCamera])

  useEffect(() => {
    if (!active) {
      headingDegRef.current = null
      onHeadingChange(null)
      onStatusChange('idle')
      sourceRef.current?.setNativeProps({
        id: 'center-phone-heading-source',
        shape: JSON.stringify(phoneHeadingShape(null, null, false)),
      })
      return
    }

    let disposed = false
    let remove: (() => void) | null = null
    let recordedAt = 0

    void startPhoneHeadingUpdates(adapter, (rawHeadingDeg) => {
      if (disposed) return
      // Offer the raw reading — pre-smoothing, so a replay runs it through the same filters a live
      // one goes through — to any Debug Recording that is running. Native drops it when none is, and
      // a replay session never records, so playing a recording cannot feed its own headings back in.
      const now = Date.now()
      if (now - recordedAt >= PHONE_HEADING_RECORD_INTERVAL_MS) {
        recordedAt = now
        recordPhoneHeading(rawHeadingDeg)
      }
      const headingDeg = deadBandPhoneHeading(headingDegRef.current, rawHeadingDeg)
      if (headingDeg === headingDegRef.current) return

      headingDegRef.current = headingDeg
      onHeadingChange(headingDeg)
      sourceRef.current?.setNativeProps({
        id: 'center-phone-heading-source',
        shape: JSON.stringify(
          phoneHeadingShape(coordinateRef.current, headingDeg, followCameraRef.current),
        ),
      })

      if (!followCameraRef.current) return
      onFollowHeading(headingDeg)
    }).then((subscription) => {
      if (disposed) {
        subscription.remove()
        return
      }
      remove = subscription.remove
      onStatusChange(subscription.status)
    })

    return () => {
      disposed = true
      remove?.()
    }
  }, [active, adapter, onFollowHeading, onHeadingChange, onStatusChange])

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
