import type { RideRoutePoint } from 'vescape-core'

export type RoutePoint = RideRoutePoint

/** SVG path for the thumbnail. Move commands preserve native GPS gaps instead of bridging them. */
export function routePreviewPath(points: RoutePoint[], width: number, height: number, padding = 8) {
  if (points.length < 2) return null
  const project = routePreviewProjection(points, width, height, padding)
  return points
    .map((point, index) => {
      const { x, y } = project(point)
      return `${index === 0 || point.breakBefore ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`
    })
    .join(' ')
}

/** Fit a local geographic projection uniformly and centre it, including flat/stationary routes. */
export function routePreviewProjection(
  points: RoutePoint[],
  width: number,
  height: number,
  padding = 8,
): (point: RoutePoint) => { x: number; y: number } {
  if (points.length === 0) return () => ({ x: width / 2, y: height / 2 })
  const origin = points[0]
  const longitudeScale = Math.cos((origin.latitude * Math.PI) / 180)
  // Wrap around the first fix so routes crossing the date line don't span the whole world.
  const longitudeOffset = (longitude: number) =>
    ((((longitude - origin.longitude + 180) % 360) + 360) % 360) - 180
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    const x = longitudeOffset(point.longitude) * longitudeScale
    const y = point.latitude - origin.latitude
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const xSpan = maxX - minX
  const ySpan = maxY - minY
  const fit = Math.min(
    xSpan > 0 ? Math.max(0, width - padding * 2) / xSpan : Infinity,
    ySpan > 0 ? Math.max(0, height - padding * 2) / ySpan : Infinity,
  )
  const scale = Number.isFinite(fit) ? fit : 0
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return (point) => ({
    x: width / 2 + (longitudeOffset(point.longitude) * longitudeScale - centerX) * scale,
    y: height / 2 - (point.latitude - origin.latitude - centerY) * scale,
  })
}
