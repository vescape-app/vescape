import type { MapPoint } from 'vescape-core'

export type MapSelection =
  | {
      type: 'coordinate'
      id: string
      latitude: number
      longitude: number
      title: string
      subtitle: string | null
      loadingDetails?: boolean
    }
  | {
      type: 'place'
      id: string
      latitude: number
      longitude: number
      title: string
      subtitle: string | null
      category: string | null
      loadingDetails?: boolean
    }
  | {
      type: 'mapPoint'
      id: string
      latitude: number
      longitude: number
      title: string
      subtitle: string | null
      point: MapPoint
      loadingDetails?: boolean
    }

export function formatMapboxCategory(value: string | null) {
  if (!value) return null
  const words = value
    .replace(/[_-]+/g, ' ')
    .replace(/\s*,\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return null
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

export function coordinateSelection(
  longitude: number,
  latitude: number,
  idPrefix: 'coordinate' | 'long-press',
): MapSelection {
  return {
    type: 'coordinate',
    id: `${idPrefix}-${longitude.toFixed(6)}-${latitude.toFixed(6)}`,
    latitude,
    longitude,
    title: 'Dropped pin',
    subtitle: null,
    loadingDetails: true,
  }
}

export function placeSelectionFromFeatures(
  features: GeoJSON.Feature[] | undefined,
  fallback: { longitude: number; latitude: number },
): MapSelection | null {
  const place = features?.find((candidate) => {
    const name = candidate.properties?.name
    return typeof name === 'string' && name.trim().length > 0
  })
  if (!place) return null

  const placeCoordinates = place.geometry.type === 'Point' ? place.geometry.coordinates : null
  const longitude =
    typeof placeCoordinates?.[0] === 'number' ? placeCoordinates[0] : fallback.longitude
  const latitude =
    typeof placeCoordinates?.[1] === 'number' ? placeCoordinates[1] : fallback.latitude
  const title = typeof place.properties?.name === 'string' ? place.properties.name : 'Map place'
  const category =
    typeof place.properties?.category === 'string'
      ? formatMapboxCategory(place.properties.category)
      : typeof place.properties?.class === 'string'
        ? formatMapboxCategory(place.properties.class)
        : null
  const subtitle =
    typeof place.properties?.full_address === 'string'
      ? place.properties.full_address
      : typeof place.properties?.address === 'string'
        ? place.properties.address
        : category

  return {
    type: 'place',
    id:
      typeof place.id === 'string'
        ? place.id
        : `place-${longitude.toFixed(6)}-${latitude.toFixed(6)}`,
    latitude,
    longitude,
    title,
    subtitle,
    category,
    loadingDetails: subtitle == null,
  }
}
