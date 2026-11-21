const MAX_RADIUS_METERS = 50_000
const MIN_RADIUS_METERS = 500
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686
const TILE_SIZE_PX = 512
const ASSUMED_VIEWPORT_PX = 1024
const MIN_WATCH_ROUTE_SPAN_METERS = 150
const MAX_WATCH_ROUTE_SPAN_METERS = 2_000

export function metersPerPixel(zoom: number, latitude: number): number | null {
  if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) return null
  const latitudeScale = Math.cos((Math.min(Math.abs(latitude), 85) * Math.PI) / 180)
  const value = (EARTH_CIRCUMFERENCE_METERS * latitudeScale) / (TILE_SIZE_PX * 2 ** zoom)
  return Number.isFinite(value) ? value : null
}

export function zoomForMetersPerPixel(scale: number, latitude: number): number {
  const latitudeScale = Math.cos((Math.min(Math.abs(latitude), 85) * Math.PI) / 180)
  return Math.log2((EARTH_CIRCUMFERENCE_METERS * latitudeScale) / (TILE_SIZE_PX * scale))
}

export function nearbyRadiusMeters(zoom: number, latitude: number): number {
  const scale = metersPerPixel(zoom, latitude)
  if (scale == null) return MIN_RADIUS_METERS
  const radius = (scale * ASSUMED_VIEWPORT_PX) / 2
  if (!Number.isFinite(radius)) return MIN_RADIUS_METERS
  const clamped = Math.min(Math.max(radius, MIN_RADIUS_METERS), MAX_RADIUS_METERS)
  const step = Math.max(MIN_RADIUS_METERS / 10, 10 ** Math.floor(Math.log10(clamped)) / 2)
  return Math.min(Math.round(clamped / step) * step, MAX_RADIUS_METERS)
}

export function watchRouteSpanMeters(
  zoom: number,
  latitude: number,
  viewportWidthPx: number,
): number | null {
  const scale = metersPerPixel(zoom, latitude)
  if (scale == null || !Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return null
  return Math.round(
    Math.min(
      Math.max(scale * viewportWidthPx, MIN_WATCH_ROUTE_SPAN_METERS),
      MAX_WATCH_ROUTE_SPAN_METERS,
    ),
  )
}

export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadius = 6_371_000
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRadians(to.latitude - from.latitude)
  const dLon = toRadians(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)))
}
