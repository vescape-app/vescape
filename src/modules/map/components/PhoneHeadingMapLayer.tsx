import type Mapbox from '@rnmapbox/maps'
import { Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import { theme } from '@/constants/theme'
import { useAppActive } from '@/hooks/useAppActive'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'
import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

type MovePointShapeAnimator = InstanceType<typeof Mapbox.__experimental.MovePointShapeAnimator>
const GPS_HEADING_ICON_ID = 'center-phone-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

interface PhoneHeadingMapLayerProps {
  pointAnimator: MovePointShapeAnimator
  active: boolean
  followCamera: boolean
  hasPosition: boolean
  onFollowHeading: (headingDeg: number) => void
  onHeadingChange: (headingDeg: number | null) => void
  onStatusChange: (status: PhoneHeadingStatus | 'idle') => void
}

/** Compass owns only rotation. The cone shares the point's native position animator in every
 * orientation. While following it points up in viewport space, avoiding a one-frame camera/cone
 * skew. Browsing rotates the icon directly; sensor samples never rewrite position geometry. */
export const PhoneHeadingMapLayer = memo(function PhoneHeadingMapLayer({
  pointAnimator,
  active,
  followCamera,
  hasPosition,
  onFollowHeading,
  onHeadingChange,
  onStatusChange,
}: PhoneHeadingMapLayerProps) {
  const appActive = useAppActive()
  const subscribed = active && appActive
  const iconRef = useRef<SymbolLayer>(null)
  const headingRef = useRef<number | null>(null)
  const latest = useRef({
    followCamera,
    hasPosition,
    onFollowHeading,
    onHeadingChange,
    onStatusChange,
  })
  useLayoutEffect(() => {
    latest.current = { followCamera, hasPosition, onFollowHeading, onHeadingChange, onStatusChange }
    iconRef.current?.setNativeProps({
      style: {
        iconRotate: followCamera ? 0 : (headingRef.current ?? 0),
        iconOpacity: subscribed && hasPosition && headingRef.current != null ? 1 : 0,
      },
    })
  }, [followCamera, hasPosition, onFollowHeading, onHeadingChange, onStatusChange, subscribed])

  useEffect(() => {
    if (!subscribed) {
      headingRef.current = null
      iconRef.current?.setNativeProps({ style: { iconOpacity: 0 } })
      latest.current.onHeadingChange(null)
      latest.current.onStatusChange('idle')
      return
    }
    let disposed = false
    let remove: (() => void) | null = null
    void startPhoneHeadingUpdates(deviceMotionPhoneHeadingAdapter, (raw) => {
      if (disposed) return
      const heading = deadBandPhoneHeading(headingRef.current, raw)
      if (heading === headingRef.current) return
      const first = headingRef.current == null
      headingRef.current = heading
      const props = latest.current
      if (!props.followCamera || first)
        iconRef.current?.setNativeProps({
          style: {
            iconRotate: props.followCamera ? 0 : heading,
            iconOpacity: props.hasPosition ? 1 : 0,
          },
        })
      props.onHeadingChange(heading)
      if (props.followCamera) props.onFollowHeading(heading)
    }).then((subscription) => {
      if (disposed) {
        subscription.remove()
        return
      }
      remove = subscription.remove
      latest.current.onStatusChange(subscription.status)
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [subscribed])

  const style = useMemo(
    () => ({
      iconImage: GPS_HEADING_ICON_ID,
      iconRotate: 0,
      iconOpacity: 0,
      iconAllowOverlap: true,
      iconIgnorePlacement: true,
      iconRotationAlignment: followCamera ? ('viewport' as const) : ('map' as const),
      iconSize: 0.95,
      iconOffset: [0, -10],
      iconColor: theme.palette.mono.white,
    }),
    [followCamera],
  )
  return (
    <>
      <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
      <ShapeSource id="center-phone-heading-source" shape={pointAnimator}>
        <SymbolLayer ref={iconRef} id="center-phone-heading-outline" style={style} />
      </ShapeSource>
    </>
  )
})
