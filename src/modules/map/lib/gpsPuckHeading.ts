import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'

/**
 * An approximate fix invalidates the GPS course — it is derived from consecutive fixes, so metres of
 * jitter turn it into a made-up direction. It says nothing about the magnetometer, which is why the
 * compass heading survives a degraded fix.
 */
export function getGpsPuckBearing({
  orientationMode,
  approximateFix,
  phoneHeadingDeg,
  gpsBearingDeg,
}: {
  orientationMode: MapOrientationMode
  approximateFix: boolean
  phoneHeadingDeg: number | null
  gpsBearingDeg: number | null
}): number | null {
  if (orientationMode === 'gpsHeading') return approximateFix ? null : gpsBearingDeg
  return phoneHeadingDeg
}
