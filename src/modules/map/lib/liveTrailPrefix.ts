/** Presentation only: the newest two measured segments form a fading, detached dust tail. */
export function liveTrailParts(
  history: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  rawFix: { longitude: number; latitude: number } | null,
): {
  body: GeoJSON.Feature<GeoJSON.LineString> | null
  tail: GeoJSON.Feature<GeoJSON.LineString> | null
} {
  const coordinates = (history?.geometry.coordinates ?? []).filter(
    (point, index, points) =>
      index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1],
  )
  const last = coordinates.at(-1)
  if (
    rawFix &&
    Number.isFinite(rawFix.longitude) &&
    Number.isFinite(rawFix.latitude) &&
    (!last || last[0] !== rawFix.longitude || last[1] !== rawFix.latitude)
  ) {
    coordinates.push([rawFix.longitude, rawFix.latitude])
  }
  const feature = (points: number[][]): GeoJSON.Feature<GeoJSON.LineString> | null =>
    points.length >= 2
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } }
      : null
  return {
    body: feature(coordinates.slice(0, -2)),
    tail: feature(coordinates.slice(-3)),
  }
}
