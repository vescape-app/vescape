import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import { distanceMeters } from '@/helpers/mapGeometry'

const SEARCH_FETCH_LIMIT = '10'
const SEARCH_RESULT_LIMIT = 5
const LOCAL_RESULT_RADIUS_METERS = 150_000

export interface MapSearchResult {
  id: string
  title: string
  subtitle: string
  latitude: number
  longitude: number
  category: string | null
}

export interface MapReverseGeocodeResult {
  title: string
  subtitle: string
}

interface MapboxGeocodingFeature {
  id?: string
  text?: string
  place_name?: string
  geometry?: {
    coordinates?: unknown
  }
  properties?: {
    mapbox_id?: string
    name?: string
    full_address?: string
    place_formatted?: string
    poi_category?: unknown
    maki?: unknown
  }
}

interface MapboxGeocodingResponse {
  features?: MapboxGeocodingFeature[]
}

function normalizeSearchQuery(query: string) {
  return query.trim()
}

function getFeatureCoordinates(feature: MapboxGeocodingFeature) {
  const coordinates = feature.geometry?.coordinates
  if (!Array.isArray(coordinates)) return null
  const [longitude, latitude] = coordinates
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  return { latitude, longitude }
}

function getFeatureTitle(feature: MapboxGeocodingFeature) {
  return feature.properties?.name ?? feature.text ?? 'Unnamed place'
}

function getFeatureSubtitle(feature: MapboxGeocodingFeature) {
  const fullAddress = feature.properties?.full_address
  const place = feature.properties?.place_formatted
  return fullAddress && place
    ? fullAddress
    : fullAddress || place || feature.place_name || 'Mapbox result'
}

export function getMapSearchCategory(properties: MapboxGeocodingFeature['properties'], title = '') {
  const categories = properties?.poi_category
  const categoryWords = Array.isArray(categories)
    ? categories.filter((value): value is string => typeof value === 'string')
    : []
  const maki = typeof properties?.maki === 'string' ? properties.maki.replaceAll('-', ' ') : null
  const classification = [...categoryWords, ...(maki && maki !== 'marker' ? [maki] : []), title]
    .filter(Boolean)
    .join(' ')
  return classification || null
}

function toMapSearchResult(feature: MapboxGeocodingFeature): MapSearchResult | null {
  const coordinate = getFeatureCoordinates(feature)
  if (!coordinate) return null

  return {
    id:
      feature.properties?.mapbox_id ??
      feature.id ??
      `${coordinate.longitude},${coordinate.latitude}`,
    title: getFeatureTitle(feature),
    subtitle: getFeatureSubtitle(feature),
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    category: getMapSearchCategory(feature.properties, getFeatureTitle(feature)),
  }
}

interface SearchMapResultsOptions {
  proximity?: { latitude: number; longitude: number } | null
  signal?: AbortSignal
}

export function prioritizeNearbySearchResults(
  results: MapSearchResult[],
  proximity: { latitude: number; longitude: number } | null | undefined,
) {
  if (!proximity) return results.slice(0, SEARCH_RESULT_LIMIT)
  const nearby: MapSearchResult[] = []
  const distant: MapSearchResult[] = []
  for (const result of results) {
    const group = distanceMeters(proximity, result) <= LOCAL_RESULT_RADIUS_METERS ? nearby : distant
    group.push(result)
  }
  return [...nearby, ...distant].slice(0, SEARCH_RESULT_LIMIT)
}

export async function searchMapResults(query: string, options: SearchMapResultsOptions = {}) {
  const normalized = normalizeSearchQuery(query)
  if (normalized.length < 2) return []
  if (!MAPBOX_ACCESS_TOKEN) throw new Error('Mapbox access token missing')

  const params = new URLSearchParams({
    q: normalized,
    access_token: MAPBOX_ACCESS_TOKEN,
    limit: SEARCH_FETCH_LIMIT,
  })
  if (options.proximity) {
    params.set('proximity', `${options.proximity.longitude},${options.proximity.latitude}`)
  }

  const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`, {
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Mapbox search failed: ${response.status}`)
  }

  const data = (await response.json()) as MapboxGeocodingResponse
  const results = (data.features ?? []).map(toMapSearchResult).filter((result) => result != null)
  return prioritizeNearbySearchResults(results, options.proximity)
}

export async function reverseGeocodeMapCoordinate(
  latitude: number,
  longitude: number,
  options: { signal?: AbortSignal } = {},
): Promise<MapReverseGeocodeResult | null> {
  if (!MAPBOX_ACCESS_TOKEN) throw new Error('Mapbox access token missing')

  const params = new URLSearchParams({
    access_token: MAPBOX_ACCESS_TOKEN,
    limit: '1',
  })
  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?${params}`,
    { signal: options.signal },
  )
  if (!response.ok) {
    throw new Error(`Mapbox reverse geocoding failed: ${response.status}`)
  }

  const data = (await response.json()) as MapboxGeocodingResponse
  const feature = data.features?.[0]
  if (!feature) return null
  return {
    title: getFeatureTitle(feature),
    subtitle: getFeatureSubtitle(feature),
  }
}
