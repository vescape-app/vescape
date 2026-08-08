import { useEffect, type RefObject } from 'react'
import type { LocationEvent } from 'vescape-core'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { getNavigationFallbackReason } from '@/modules/map/lib/navigationDiagnostics'
import type { PhoneHeadingStatus } from '@/modules/map/lib/phoneHeading'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

export function useNavigationDiagnosticsSync({
  gpsFix,
  retainedGpsBearing,
  phoneHeadingDegRef,
  phoneHeadingStatus,
  gpsPinBearingDeg,
  displayedCameraHeading,
  mapOrientationMode,
}: {
  gpsFix: LocationEvent | null
  retainedGpsBearing: { bearingDeg: number; sourceTimestamp: number } | null
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
      retainedGpsBearingDeg: retainedGpsBearing?.bearingDeg ?? null,
      retainedGpsBearingAt: retainedGpsBearing?.sourceTimestamp ?? null,
      phoneHeadingDeg: phoneHeadingDegRef.current,
      phoneHeadingStatus,
      activeDisplayHeadingDeg: gpsPinBearingDeg,
      cameraHeadingDeg: displayedCameraHeading,
      fallbackReason: getNavigationFallbackReason({
        mapOrientationMode,
        gpsFix,
        retainedGpsBearingDeg: retainedGpsBearing?.bearingDeg ?? null,
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
    retainedGpsBearing?.bearingDeg,
    retainedGpsBearing?.sourceTimestamp,
    updateNavigationDiagnostics,
  ])
}
