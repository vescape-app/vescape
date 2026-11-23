import { useEffect, useEffectEvent, useRef } from 'react'

import { useAppActive } from '@/hooks/useAppActive'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'
import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

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
  const appActive = useAppActive()
  const subscribed = active && appActive
  const headingDegRef = useRef<number | null>(null)
  const followCameraRef = useRef(followCamera)

  useEffect(() => {
    followCameraRef.current = followCamera
  })

  const reportHeading = useEffectEvent((headingDeg: number) => {
    onHeadingChange(headingDeg)
    if (followCameraRef.current) onFollowHeading(headingDeg)
  })
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
