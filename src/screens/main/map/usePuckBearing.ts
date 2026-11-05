import { useEffect, useRef } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import { startHeadingAnimation } from '@/modules/map/lib/liveMotion/headingAnimation'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import type { MainMapLayersProps } from './mainMapLayerTypes'

/** All orientations animate native GPS travel direction, independently of phone compass. */
export function usePuckBearing({
  approximateFix,
  displayRuntime,
}: {
  approximateFix: boolean
  displayRuntime: MainMapLayersProps['displayRuntime']
}) {
  const puckBearing = useSharedValue<number | null>(null)
  const angle = useRef(0)
  useEffect(() => {
    if (approximateFix) {
      puckBearing.set(null)
      return
    }
    return startHeadingAnimation({
      angle,
      heading: () => {
        const target = displayRuntime.motion.pointHeading(displayRuntime.now())
        if (target == null) puckBearing.set(null)
        return target
      },
      omega: () => useLiveMotionSettings.getState().config.arrowHeadingOmega,
      draw: (heading) => puckBearing.set(heading),
      subscribe: displayRuntime.subscribe,
      isActive: () => displayRuntime.active,
      now: () => performance.now(),
      schedule: requestAnimationFrame,
      cancel: cancelAnimationFrame,
    })
  }, [approximateFix, displayRuntime, puckBearing])
  return puckBearing
}
