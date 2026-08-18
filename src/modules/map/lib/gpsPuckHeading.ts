import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'

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
  if (approximateFix) return null
  return orientationMode === 'gpsHeading' ? gpsBearingDeg : phoneHeadingDeg
}
