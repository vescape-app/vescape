import { expect, test } from 'bun:test'

import { getMapSearchCategory } from '@/modules/map/lib/search'

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
