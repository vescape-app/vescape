import { useEffect, type RefObject } from 'react'
import type { SharedValue } from 'react-native-reanimated'
import type { LocationEvent } from 'vescape-core'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import type { MapPose } from '@/modules/map/components/GpsPuck'
import { getNavigationFallbackReason } from '@/modules/map/lib/navigationDiagnostics'
import type { PhoneHeadingStatus } from '@/modules/map/lib/phoneHeading'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

export function useNavigationDiagnosticsSync({
  gpsFix,
  courseDeg,
  courseSourceTimestamp,
  phoneHeadingDegRef,
  phoneHeadingStatus,
  puckBearing,
  mapPose,
  mapOrientationMode,
}: {
  gpsFix: LocationEvent | null
  courseDeg: number | null
  courseSourceTimestamp: number | null
  phoneHeadingDegRef: RefObject<number | null>
  phoneHeadingStatus: PhoneHeadingStatus | 'idle'
  puckBearing: SharedValue<number | null>
  mapPose: SharedValue<MapPose>
  mapOrientationMode: MapOrientationMode
}) {
  const consumers = useNavigationDiagnosticsStore((state) => state.motionConsumers)
  const updateNavigationDiagnostics = useNavigationDiagnosticsStore((state) => state.update)

  // Synced per fix; the camera heading is sampled then, not tracked — re-rendering the map for it
  // cost a render per camera idle.
  useEffect(() => {
    if (!consumers) return
    const cameraHeadingDeg = mapPose.get().heading
    const bearing = puckBearing.get()
    updateNavigationDiagnostics({
      gpsFix,
      retainedGpsBearingDeg: courseDeg,
      retainedGpsBearingAt: courseSourceTimestamp,
      phoneHeadingDeg: phoneHeadingDegRef.current,
      phoneHeadingStatus,
      activeDisplayHeadingDeg: bearing == null ? null : bearing - cameraHeadingDeg,
      cameraHeadingDeg,
      fallbackReason: getNavigationFallbackReason({
        mapOrientationMode,
        gpsFix,
        retainedGpsBearingDeg: courseDeg,
        phoneHeadingDeg: phoneHeadingDegRef.current,
        phoneHeadingStatus,
      }),
    })
  }, [
    consumers,
    gpsFix,
    puckBearing,
    mapOrientationMode,
    mapPose,
    phoneHeadingDegRef,
    phoneHeadingStatus,
    courseDeg,
    courseSourceTimestamp,
    updateNavigationDiagnostics,
  ])
}
