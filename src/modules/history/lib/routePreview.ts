import type { RideRoutePoint } from 'vescape-core'

export type RoutePoint = RideRoutePoint

/** Metres the thumbnail always spans at least, so a short or stationary ride still shows its streets. */
const MIN_SPAN_M = 300
const EARTH_CIRCUMFERENCE_M = 40_075_016.686
/** Pixels across one tile served by the native `mapTile`. */
const TILE_PX = 512
/** Map tiles never zoom past this, however small the ride. */
const MAX_TILE_ZOOM = 17

export interface RoutePreviewTile {
  z: number
  x: number
  y: number
  /** Placement in the thumbnail, in layout points. */
  left: number
  top: number
  size: number
}

/** Web Mercator in world units (0..1). Longitude stays unwrapped so the caller can wrap around a reference. */
function mercator(point: RoutePoint) {
  const sin = Math.sin((point.latitude * Math.PI) / 180)
  return {
    x: (point.longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  }
}

interface PreviewFrame {
  /** Layout points per world unit. */
  scale: number
  centerX: number
  centerY: number
  width: number
  height: number
  /** World x of a point, wrapped around the first fix so routes crossing the date line stay together. */
  worldX: (point: RoutePoint) => number
}

/** Fit the route uniformly into the thumbnail, centred, never tighter than [MIN_SPAN_M]. */
function previewFrame(
  points: RoutePoint[],
  width: number,
  height: number,
  padding: number,
): PreviewFrame | null {
  if (points.length === 0) return null
  const originX = mercator(points[0]).x
  const worldX = (point: RoutePoint) =>
    originX + ((((mercator(point).x - originX + 0.5) % 1) + 1) % 1) - 0.5
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    const x = worldX(point)
    const { y } = mercator(point)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const minSpan =
    MIN_SPAN_M / (EARTH_CIRCUMFERENCE_M * Math.cos((points[0].latitude * Math.PI) / 180))
  const scale = Math.min(
    Math.max(0, width - padding * 2) / Math.max(maxX - minX, minSpan),
    Math.max(0, height - padding * 2) / Math.max(maxY - minY, minSpan),
  )
  return { scale, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width, height, worldX }
}

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

/** Project a point into the thumbnail with the same Web Mercator frame the map tiles use. */
export function routePreviewProjection(
  points: RoutePoint[],
  width: number,
  height: number,
  padding = 8,
): (point: RoutePoint) => { x: number; y: number } {
  const frame = previewFrame(points, width, height, padding)
  if (!frame) return () => ({ x: width / 2, y: height / 2 })
  return (point) => ({
    x: width / 2 + (frame.worldX(point) - frame.centerX) * frame.scale,
    y: height / 2 + (mercator(point).y - frame.centerY) * frame.scale,
  })
}

/**
 * Map tiles covering the thumbnail behind its route. The zoom is the lowest whose tiles still have at
 * least one pixel per screen pixel, so tiles are only ever scaled down.
 */
export function routePreviewTiles(
  points: RoutePoint[],
  width: number,
  height: number,
  pixelRatio: number,
  padding = 8,
): RoutePreviewTile[] {
  const frame = previewFrame(points, width, height, padding)
  if (!frame || frame.scale <= 0) return []
  const z = Math.min(
    MAX_TILE_ZOOM,
    Math.max(0, Math.ceil(Math.log2((frame.scale * pixelRatio) / TILE_PX))),
  )
  const count = 2 ** z
  const size = frame.scale / count
  const left = (worldX: number) => width / 2 + (worldX - frame.centerX) * frame.scale
  const top = (worldY: number) => height / 2 + (worldY - frame.centerY) * frame.scale
  const firstX = Math.floor((frame.centerX - width / 2 / frame.scale) * count)
  const lastX = Math.ceil((frame.centerX + width / 2 / frame.scale) * count) - 1
  const firstY = Math.max(0, Math.floor((frame.centerY - height / 2 / frame.scale) * count))
  const lastY = Math.min(
    count - 1,
    Math.ceil((frame.centerY + height / 2 / frame.scale) * count) - 1,
  )
  const tiles: RoutePreviewTile[] = []
  for (let tileY = firstY; tileY <= lastY; tileY++) {
    for (let tileX = firstX; tileX <= lastX; tileX++) {
      tiles.push({
        z,
        x: ((tileX % count) + count) % count,
        y: tileY,
        left: left(tileX / count),
        top: top(tileY / count),
        size,
      })
    }
  }
  return tiles
}
