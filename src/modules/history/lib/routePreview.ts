import { Skia } from '@shopify/react-native-skia'

export interface RoutePoint {
  latitude: number
  longitude: number
}

/** The route fitted into a `width`×`height` thumbnail, or null when there is nothing to draw. */
export function routePreviewPath(points: RoutePoint[], width: number, height: number, padding = 8) {
  if (points.length < 2) return null
  const project = routePreviewProjection(points, width, height, padding)
  const first = project(points[0])
  const builder = Skia.PathBuilder.Make().moveTo(first.x, first.y)
  for (const point of points.slice(1)) {
    const { x, y } = project(point)
    builder.lineTo(x, y)
  }
  return builder.detach()
}

/** Same fit as the path, exposed so callers can place markers on the drawn route. */
export function routePreviewProjection(
  points: RoutePoint[],
  width: number,
  height: number,
  padding = 8,
): (point: RoutePoint) => { x: number; y: number } {
  const latitudes = points.map((point) => point.latitude)
  const longitudes = points.map((point) => point.longitude)
  const minLatitude = Math.min(...latitudes)
  const maxLatitude = Math.max(...latitudes)
  const minLongitude = Math.min(...longitudes)
  const maxLongitude = Math.max(...longitudes)
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.00001)
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.00001)

  return (point) => ({
    x: padding + ((point.longitude - minLongitude) / longitudeSpan) * (width - padding * 2),
    y: padding + ((maxLatitude - point.latitude) / latitudeSpan) * (height - padding * 2),
  })
}
