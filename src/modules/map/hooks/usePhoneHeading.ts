import { useEffect, useLayoutEffect, useRef } from 'react'

import { useAppActive } from '@/hooks/useAppActive'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'
import {
  deadBandPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingStatus,
} from '@/modules/map/lib/phoneHeading'

export function usePhoneHeading({
  active,
  onHeadingChange,
  onStatusChange,
}: {
  active: boolean
  onHeadingChange: (headingDeg: number | null) => void
  onStatusChange: (status: PhoneHeadingStatus | 'idle') => void
}) {
  const appActive = useAppActive()
  const subscribed = active && appActive
  const headingDegRef = useRef<number | null>(null)
  const callbacksRef = useRef({ onHeadingChange, onStatusChange })

  useLayoutEffect(() => {
    callbacksRef.current = { onHeadingChange, onStatusChange }
  })

  useEffect(() => {
    if (!subscribed) {
      headingDegRef.current = null
      callbacksRef.current.onHeadingChange(null)
      callbacksRef.current.onStatusChange('idle')
      return
    }

    let disposed = false
    let remove: (() => void) | null = null

    void startPhoneHeadingUpdates(deviceMotionPhoneHeadingAdapter, (rawHeadingDeg) => {
      if (disposed) return
      const headingDeg = deadBandPhoneHeading(headingDegRef.current, rawHeadingDeg)
      if (headingDeg === headingDegRef.current) return
      headingDegRef.current = headingDeg
      callbacksRef.current.onHeadingChange(headingDeg)
    }).then((subscription) => {
      if (disposed) {
        subscription.remove()
        return
      }
      remove = subscription.remove
      callbacksRef.current.onStatusChange(subscription.status)
    })

    return () => {
      disposed = true
      remove?.()
    }
  }, [subscribed])
}
