import { Skia } from '@shopify/react-native-skia'

import type { HistorySession } from '@/modules/history/lib/sessions'
import type { TelemetryMinuteBucket } from 'vescape-core'

export interface RoutePoint {
  latitude: number
  longitude: number
}

/**
 * One coarse point per recorded minute of a ride — enough to recognise a route as a thumbnail
 * without loading its GPS samples.
 */
export function sessionRoutePoints(
  blocks: TelemetryMinuteBucket[],
  session: Pick<HistorySession, 'blockIds'>,
): RoutePoint[] {
  const blockIds = new Set(session.blockIds)
  return blocks
    .filter(
      (block) =>
        blockIds.has(block.id) && block.firstLatitude != null && block.firstLongitude != null,
    )
    .sort((a, b) => a.startAtMs - b.startAtMs)
    .map((block) => ({ latitude: block.firstLatitude!, longitude: block.firstLongitude! }))
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
