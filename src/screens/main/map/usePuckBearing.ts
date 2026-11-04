import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'
import { startHeadingAnimation } from '@/modules/map/lib/liveMotion/headingAnimation'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import type { MainMapLayersProps } from './mainMapLayerTypes'

/** Compass writes directly; GPS animates native direction targets without React frame updates. */
export function usePuckBearing({
  orientationMode,
  approximateFix,
  displayRuntime,
  phoneHeadingDegRef,
}: {
  orientationMode: MapOrientationMode
  approximateFix: boolean
  displayRuntime: MainMapLayersProps['displayRuntime']
  phoneHeadingDegRef: RefObject<number | null>
}) {
  const puckBearing = useSharedValue<number | null>(null)
  const angle = useRef(0)
  const syncPuckBearing = useCallback(
    (phoneHeadingDeg: number | null) => {
      if (orientationMode === 'phoneHeading')
        puckBearing.set(
          getGpsPuckBearing({
            orientationMode,
            approximateFix,
            phoneHeadingDeg,
            gpsBearingDeg: null,
          }),
        )
    },
    [approximateFix, orientationMode, puckBearing],
  )
  useEffect(() => {
    if (orientationMode === 'phoneHeading') {
      syncPuckBearing(phoneHeadingDegRef.current)
      return
    }
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
  }, [
    approximateFix,
    displayRuntime,
    orientationMode,
    phoneHeadingDegRef,
    puckBearing,
    syncPuckBearing,
  ])
  return { puckBearing, syncPuckBearing }
}
