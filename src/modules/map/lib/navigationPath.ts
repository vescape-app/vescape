import type { Navigation, RouteProgress } from 'vescape-core'

type Coordinate = [number, number]

function splitNavigationPath(navigation: Navigation | null, progress: RouteProgress | null) {
  if (!navigation || navigation.status !== 'ready' || navigation.coordinates.length < 2) return null
  const coordinates = navigation.coordinates
  const segment = progress?.segmentIndex
  if (
    !progress ||
    progress.navigationRevision !== navigation.revision ||
    segment == null ||
    segment < 0 ||
    segment >= coordinates.length - 1
  ) {
    return { passed: [] as Coordinate[], remaining: coordinates }
  }
  const split: Coordinate = [progress.longitude, progress.latitude]
  return {
    passed:
      segment === 0 && progress.segmentFraction === 0
        ? []
        : [...coordinates.slice(0, segment + 1), split],
    remaining:
      segment === coordinates.length - 2 && progress.segmentFraction === 1
        ? [split]
        : [split, ...coordinates.slice(segment + 1)],
  }
}

export function navigationPathShape(
  navigation: Navigation | null,
  progress: RouteProgress | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString> | null {
  const path = splitNavigationPath(navigation, progress)
  if (!path) return null
  const line = (
    coordinates: Coordinate[],
    opacity: number,
  ): GeoJSON.Feature<GeoJSON.LineString> => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { opacity },
  })
  return {
    type: 'FeatureCollection',
    features: [
      ...(path.passed.length > 1 ? [line(path.passed, 0.2)] : []),
      ...(path.remaining.length > 1 ? [line(path.remaining, 1)] : []),
    ],
  }
}

export function navigationCameraPath(
  navigation: Navigation | null,
  progress: RouteProgress | null,
): Coordinate[] {
  return splitNavigationPath(navigation, progress)?.remaining ?? []
}
