import { expect, test } from 'bun:test'

import { getPlaceCategoryIconKey } from '@/modules/map-points/constants/placeCategoryIcon'

test('maps Mapbox place categories onto navigation icons', () => {
  expect(getPlaceCategoryIconKey('Park')).toBe('nature')
  expect(getPlaceCategoryIconKey('Park and recreation')).toBe('nature')
  expect(getPlaceCategoryIconKey('Restaurant')).toBe('food')
  expect(getPlaceCategoryIconKey('Parking')).toBe('parking')
  expect(getPlaceCategoryIconKey('Primary school')).toBe('school')
  expect(getPlaceCategoryIconKey('University campus')).toBe('university')
  expect(getPlaceCategoryIconKey('Bus station')).toBe('bus')
  expect(getPlaceCategoryIconKey('Tram stop')).toBe('tram')
  expect(getPlaceCategoryIconKey('Railway station')).toBe('rail')
})

test('keeps the map pin for unknown place categories', () => {
  expect(getPlaceCategoryIconKey(null)).toBe('place')
  expect(getPlaceCategoryIconKey('Unmapped category')).toBe('place')
})
