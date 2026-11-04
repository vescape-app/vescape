import { type RefObject, useCallback, useEffect } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'

/**
 * The puck arrow's map bearing. The compass writes it from its own callback, so a 60 Hz sensor
 * turns the arrow on the UI thread without re-rendering the map.
 */
export function usePuckBearing({
  orientationMode,
  approximateFix,
  gpsBearingDeg,
  phoneHeadingDegRef,
}: {
  orientationMode: MapOrientationMode
  approximateFix: boolean
  gpsBearingDeg: number | null
  phoneHeadingDegRef: RefObject<number | null>
}) {
  const puckBearing = useSharedValue<number | null>(null)
  const syncPuckBearing = useCallback(
    (phoneHeadingDeg: number | null) => {
      puckBearing.set(
        getGpsPuckBearing({ orientationMode, approximateFix, phoneHeadingDeg, gpsBearingDeg }),
      )
    },
    [approximateFix, gpsBearingDeg, orientationMode, puckBearing],
  )
  useEffect(() => {
    syncPuckBearing(phoneHeadingDegRef.current)
  }, [phoneHeadingDegRef, syncPuckBearing])
  return { puckBearing, syncPuckBearing }
}
