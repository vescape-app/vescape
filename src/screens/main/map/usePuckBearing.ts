import { type RefObject, useCallback, useEffect } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'
import { puckLayerChannel } from '@/modules/map/lib/nativePuck'

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
      const bearing = getGpsPuckBearing({
        orientationMode,
        approximateFix,
        phoneHeadingDeg,
        gpsBearingDeg,
      })
      puckBearing.set(bearing)
      puckLayerChannel.setBearing(bearing)
    },
    [approximateFix, gpsBearingDeg, orientationMode, puckBearing],
  )
  useEffect(() => {
    syncPuckBearing(phoneHeadingDegRef.current)
  }, [phoneHeadingDegRef, syncPuckBearing])
  return { puckBearing, syncPuckBearing }
}
