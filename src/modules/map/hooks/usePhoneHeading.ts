import { useEffect, useEffectEvent, useRef } from 'react'

import { useAppActive } from '@/hooks/useAppActive'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'
import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

/**
 * Runs the phone compass while `active` and reports each dead-banded heading. While
 * `followCamera`, every heading also goes to `onFollowHeading` to turn the camera.
 */
export function usePhoneHeading({
  active,
  followCamera,
  onFollowHeading,
  onHeadingChange,
  onStatusChange,
}: {
  active: boolean
  followCamera: boolean
  onFollowHeading: (headingDeg: number) => void
  onHeadingChange: (headingDeg: number | null) => void
  onStatusChange: (status: PhoneHeadingStatus | 'idle') => void
}) {
  // The compass exists to be looked at: nothing records it, and no native work depends on it. A
  // backgrounded app kept the sensor running at 60 Hz and kept retargeting the camera spring
  // against a map nobody could see, and the retargets came due all at once on unlock.
  const appActive = useAppActive()
  const subscribed = active && appActive
  const headingDegRef = useRef<number | null>(null)

  // Effect events, not dependencies: the callbacks change identity as the rider moves — the
  // tracked-point list they close over is rebuilt every metre — and must not restart DeviceMotion
  // several times a second mid-ride.
  // A ref, not the effect event's closure: under the React Compiler the effect event kept the
  // `followCamera` of an earlier render, so headings arriving after follow began were dropped.
  const followCameraRef = useRef(followCamera)
  useEffect(() => {
    followCameraRef.current = followCamera
  })
  const reportHeading = useEffectEvent((headingDeg: number) => {
    onHeadingChange(headingDeg)
    if (followCameraRef.current) onFollowHeading(headingDeg)
  })
  // Follow can start after the last reading: switching to compass while browsing recenters a
  // moment after the first heading arrives, and a phone lying still sends no second one. Hand
  // the camera the heading it missed.
  const followLatestHeading = useEffectEvent(() => {
    if (headingDegRef.current != null) onFollowHeading(headingDegRef.current)
  })
  useEffect(() => {
    if (followCamera) followLatestHeading()
  }, [followCamera])
  const reportIdle = useEffectEvent(() => {
    onHeadingChange(null)
    onStatusChange('idle')
  })
  const reportStatus = useEffectEvent((status: PhoneHeadingStatus) => onStatusChange(status))

  useEffect(() => {
    if (!subscribed) {
      headingDegRef.current = null
      reportIdle()
      return
    }

    let disposed = false
    let remove: (() => void) | null = null

    void startPhoneHeadingUpdates(deviceMotionPhoneHeadingAdapter, (rawHeadingDeg) => {
      if (disposed) return
      const headingDeg = deadBandPhoneHeading(headingDegRef.current, rawHeadingDeg)
      if (headingDeg === headingDegRef.current) return
      headingDegRef.current = headingDeg
      reportHeading(headingDeg)
    }).then((subscription) => {
      if (disposed) {
        subscription.remove()
        return
      }
      remove = subscription.remove
      reportStatus(subscription.status)
    })

    return () => {
      disposed = true
      remove?.()
    }
  }, [subscribed])
}
