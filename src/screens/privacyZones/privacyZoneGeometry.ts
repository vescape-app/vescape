import { metersPerPixel, zoomForMetersPerPixel } from '@/modules/map/lib/nearbyRadius'

export const DEFAULT_ZONE_ZOOM = 15
/** The zone circle covers this fraction of the screen width, whatever the zone's radius. */
export const CIRCLE_DIAMETER_RATIO = 0.6

export function radiusFromZoom(zoom: number, circleRadiusPx: number, latitude: number): number {
  return (metersPerPixel(zoom, latitude) ?? 0) * circleRadiusPx
}

export function zoomFromRadius(radiusM: number, circleRadiusPx: number, latitude: number): number {
  return zoomForMetersPerPixel(radiusM / circleRadiusPx, latitude)
}
