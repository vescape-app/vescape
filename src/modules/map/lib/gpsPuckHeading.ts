import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'

/**
 * The arrow shows where the rider is going: the GPS course. Only Compass mode, which turns the map
 * with the phone, shows the phone's heading instead — anywhere else that is just where a mounted
 * or pocketed phone happens to point.
 *
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
  if (orientationMode === 'phoneHeading') return phoneHeadingDeg
  return approximateFix ? null : gpsBearingDeg
}
