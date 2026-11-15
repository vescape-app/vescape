import { expect, test } from 'bun:test'

import {
  countryFromReverseGeocode,
  getMapSearchCategory,
  prioritizeNearbySearchResults,
  type MapSearchResult,
} from '@/modules/map/lib/search'

function result(id: string, latitude: number, longitude: number): MapSearchResult {
  return { id, title: id, subtitle: '', latitude, longitude, category: null }
}

test('keeps all Mapbox classification hints and the result title', () => {
  expect(getMapSearchCategory({ poi_category: ['parking', 'transportation'] }, 'Central')).toBe(
    'parking transportation Central',
  )
  expect(getMapSearchCategory({ poi_category: ['university', 'education'] }, 'Campus')).toBe(
    'university education Campus',
  )
})

test('falls back to the Maki name when Mapbox omits POI categories', () => {
  expect(getMapSearchCategory({ maki: 'rail-light' })).toBe('rail light')
  expect(getMapSearchCategory(undefined)).toBeNull()
})

test('moves nearby suggestions ahead of distant results without hiding global fallback', () => {
  const ranked = prioritizeNearbySearchResults(
    [result('distant-first', 40.7128, -74.006), result('nearby-second', 51.1079, 17.0385)],
    { latitude: 51.1, longitude: 17.03 },
  )

  expect(ranked.map(({ id }) => id)).toEqual(['nearby-second', 'distant-first'])
})

test('preserves Mapbox relevance order inside the nearby group', () => {
  const ranked = prioritizeNearbySearchResults(
    [result('first', 51.11, 17.04), result('second', 51.12, 17.05)],
    { latitude: 51.1, longitude: 17.03 },
  )

  expect(ranked.map(({ id }) => id)).toEqual(['first', 'second'])
})

test('reads the country from the reverse-geocode context, or the feature when it is the country', () => {
  const street = {
    id: 'address.1',
    context: [
      { id: 'region.2', short_code: 'PL-MZ' },
      { id: 'country.3', short_code: 'pl' },
    ],
  }
  expect(countryFromReverseGeocode(JSON.stringify({ features: [street] }))).toBe('PL')
  const country = { id: 'country.4', properties: { short_code: 'de' } }
  expect(countryFromReverseGeocode(JSON.stringify({ features: [country] }))).toBe('DE')
  expect(countryFromReverseGeocode(JSON.stringify({ features: [] }))).toBeNull()
})
