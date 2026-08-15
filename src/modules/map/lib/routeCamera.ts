/**
 * Framing a line of coordinates so the whole of it is on screen: a recorded ride in History, a
 * Navigation path on the map. Both want the same thing — bounds in, centre and zoom out — so the
 * geometry lives here once rather than per feature.
 */
import { getBounds } from '@/helpers/mapGeometry'

const MERCATOR_TILE_SIZE = 512
const MIN_ZOOM = 0
const MAX_LATITUDE = 85.05112878

export const ROUTE_CAMERA = {
  routePaddingPx: 120,
  sidePaddingPx: 72,
  fallbackZoom: 11.8,
  /** Bottom interface height assumed when a caller does not measure one. */
  defaultBottomInsetPx: 180,
} as const

export interface RouteCameraViewport {
  width: number
  height: number
  /**
   * Height of whatever covers the bottom of the map — the History panel, which grows as the rider
   * opens more metrics. The route is fitted into what is left, so opening a chart reframes it.
   */
  bottomInset?: number
}

interface RouteCameraPadding {
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export interface RouteCameraSnapshot {
  centerCoordinate: [number, number]
  zoomLevel: number
  padding: RouteCameraPadding
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mercatorY(latitude: number) {
  const clamped = clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE)
  const radians = (clamped * Math.PI) / 180
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
}

function latitudeFromMercatorY(y: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
}

function routePadding(viewport: RouteCameraViewport): RouteCameraPadding {
  return {
    paddingTop: ROUTE_CAMERA.routePaddingPx + 90,
    paddingRight: ROUTE_CAMERA.sidePaddingPx,
    paddingBottom:
      ROUTE_CAMERA.routePaddingPx + (viewport.bottomInset ?? ROUTE_CAMERA.defaultBottomInsetPx),
    paddingLeft: ROUTE_CAMERA.sidePaddingPx,
  }
}

function zoomForRouteBounds(
  bounds: ReturnType<typeof getBounds>,
  viewport: RouteCameraViewport,
  padding: RouteCameraPadding,
  maxZoom: number,
) {
  const innerWidth = viewport.width - padding.paddingLeft - padding.paddingRight
  const innerHeight = viewport.height - padding.paddingTop - padding.paddingBottom
  if (innerWidth <= 0 || innerHeight <= 0) return ROUTE_CAMERA.fallbackZoom

  const longitudeDelta = Math.max(Math.abs(bounds.ne[0] - bounds.sw[0]), 0.000001)
  const yDelta = Math.max(Math.abs(mercatorY(bounds.ne[1]) - mercatorY(bounds.sw[1])), 0.000001)
  const zoomX = Math.log2(innerWidth / (MERCATOR_TILE_SIZE * (longitudeDelta / 360)))
  const zoomY = Math.log2(innerHeight / (MERCATOR_TILE_SIZE * yDelta))
  return clamp(Math.min(zoomX, zoomY), MIN_ZOOM, maxZoom)
}

export function getRouteFitCamera({
  route,
  viewport,
  maxZoom,
}: {
  route: [number, number][]
  viewport: RouteCameraViewport
  maxZoom: number
}): RouteCameraSnapshot | null {
  if (route.length === 0) return null
  const padding = routePadding(viewport)
  if (route.length === 1) {
    return {
      centerCoordinate: route[0],
      zoomLevel: clamp(ROUTE_CAMERA.fallbackZoom, MIN_ZOOM, maxZoom),
      padding,
    }
  }

  const bounds = getBounds(route)
  const centerLongitude = (bounds.ne[0] + bounds.sw[0]) / 2
  const centerLatitude = latitudeFromMercatorY(
    (mercatorY(bounds.ne[1]) + mercatorY(bounds.sw[1])) / 2,
  )
  return {
    centerCoordinate: [centerLongitude, centerLatitude],
    zoomLevel: zoomForRouteBounds(bounds, viewport, padding, maxZoom),
    padding,
  }
}
