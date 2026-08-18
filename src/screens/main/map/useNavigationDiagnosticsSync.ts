import { useEffect, type RefObject } from 'react'
import type { LocationEvent } from 'vescape-core'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { getNavigationFallbackReason } from '@/modules/map/lib/navigationDiagnostics'
import type { PhoneHeadingStatus } from '@/modules/map/lib/phoneHeading'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

export function useNavigationDiagnosticsSync({
  gpsFix,
  courseDeg,
  courseSourceTimestamp,
  phoneHeadingDegRef,
  phoneHeadingStatus,
  gpsPinBearingDeg,
  displayedCameraHeading,
  mapOrientationMode,
}: {
  gpsFix: LocationEvent | null
  courseDeg: number | null
  courseSourceTimestamp: number | null
  phoneHeadingDegRef: RefObject<number | null>
  phoneHeadingStatus: PhoneHeadingStatus | 'idle'
  gpsPinBearingDeg: number | null
  displayedCameraHeading: number
  mapOrientationMode: MapOrientationMode
}) {
  const updateNavigationDiagnostics = useNavigationDiagnosticsStore((state) => state.update)

  useEffect(() => {
    updateNavigationDiagnostics({
      gpsFix,
      retainedGpsBearingDeg: courseDeg,
      retainedGpsBearingAt: courseSourceTimestamp,
      phoneHeadingDeg: phoneHeadingDegRef.current,
      phoneHeadingStatus,
      activeDisplayHeadingDeg: gpsPinBearingDeg,
      cameraHeadingDeg: displayedCameraHeading,
      fallbackReason: getNavigationFallbackReason({
        mapOrientationMode,
        gpsFix,
        retainedGpsBearingDeg: courseDeg,
        phoneHeadingDeg: phoneHeadingDegRef.current,
        phoneHeadingStatus,
      }),
    })
  }, [
    displayedCameraHeading,
    gpsFix,
    gpsPinBearingDeg,
    mapOrientationMode,
    phoneHeadingDegRef,
    phoneHeadingStatus,
    courseDeg,
    courseSourceTimestamp,
    updateNavigationDiagnostics,
  ])
}
