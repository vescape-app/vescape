export function zoomLevelForDelta(delta: number): number {
  return Math.max(3, Math.min(19, Math.log2(360 / Math.max(delta, 0.0001))))
}

export function isPointOutsideVisibleMapArea(
  point: { x: number; y: number },
  layout: { width: number; height: number },
  verticalInsets: { top: number; bottom: number },
): boolean {
  const top = Math.min(verticalInsets.top, layout.height / 2)
  const bottom = Math.max(top, layout.height - verticalInsets.bottom)

  return point.x < 0 || point.x > layout.width || point.y < top || point.y > bottom
}

/** Earth's equatorial radius, the sphere every coordinate offset here is measured on. */
const EARTH_RADIUS_M = 6_378_137

/** Offset a coordinate by [distanceM] along [headingDeg] (0 = north, clockwise). */
export function offsetCoordinate(
  [longitude, latitude]: [number, number],
  headingDeg: number,
  distanceM: number,
): [number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const latRad = (latitude * Math.PI) / 180
  const dLat = ((distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M) * (180 / Math.PI)
  const dLon =
    ((distanceM * Math.sin(headingRad)) / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI)
  return [longitude + dLon, latitude + dLat]
}

const CIRCLE_SEGMENTS = 64

export function makeCircleFeature(
  longitude: number,
  latitude: number,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coordinates: [number, number][] = []
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    coordinates.push(offsetCoordinate([longitude, latitude], (i / CIRCLE_SEGMENTS) * 360, radiusM))
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coordinates] },
    properties: {},
  }
}

export function makeTrailLineString(
  locations: { longitude: number; latitude: number }[],
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: locations.map((l) => [l.longitude, l.latitude]),
    },
    properties: {},
  }
}

export function distanceMeters(
  from: { longitude: number; latitude: number },
  to: { longitude: number; latitude: number },
): number {
  const earthRadiusM = 6_378_137
  const fromLatRad = (from.latitude * Math.PI) / 180
  const toLatRad = (to.latitude * Math.PI) / 180
  const deltaLat = toLatRad - fromLatRad
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180
  const halfChord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(deltaLon / 2) ** 2

  return 2 * earthRadiusM * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord))
}

export function getBounds(coordinates: [number, number][]): {
  ne: [number, number]
  sw: [number, number]
} {
  let minLon = coordinates[0][0]
  let maxLon = coordinates[0][0]
  let minLat = coordinates[0][1]
  let maxLat = coordinates[0][1]
  for (const [longitude, latitude] of coordinates) {
    minLon = Math.min(minLon, longitude)
    maxLon = Math.max(maxLon, longitude)
    minLat = Math.min(minLat, latitude)
    maxLat = Math.max(maxLat, latitude)
  }
  return {
    ne: [maxLon, maxLat],
    sw: [minLon, minLat],
  }
}
