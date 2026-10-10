import { expect, test } from 'bun:test'
import fixtures from '../../shared/fixtures/rider-units.json'
import { formatDistanceMeters } from './units'

test('watch distance fixtures agree with phone presentation', () => {
  for (const fixture of fixtures) {
    for (const units of ['metric', 'imperial'] as const) {
      expect(formatDistanceMeters(fixture.meters, units)).toBe(fixture[units])
    }
  }
})
