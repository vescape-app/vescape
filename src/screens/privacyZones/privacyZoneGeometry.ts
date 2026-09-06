import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'

export const DEFAULT_ZONE_ZOOM = 15
/** The zone circle covers this fraction of the screen width, whatever the zone's radius. */
export const CIRCLE_DIAMETER_RATIO = 0.6

export function radiusFromZoom(zoom: number, circleRadiusPx: number, latitude: number): number {
  const mpp = (40_075_016 * Math.cos((latitude * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
  return mpp * circleRadiusPx
}

export function zoomFromRadius(radiusM: number, circleRadiusPx: number, latitude: number): number {
  const numerator = 40_075_016 * Math.cos((latitude * Math.PI) / 180) * circleRadiusPx
  return Math.log2(numerator / (256 * radiusM))
}

export function currentLocation(): [number, number] {
  const snap = liveTelemetryRuntime.getSnapshot()
  const loc = snap.latestApproximateLocation
  if (loc) return [loc.longitude, loc.latitude]
  return MAP_DEFAULTS.fallbackCoordinate
}
