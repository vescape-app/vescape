import { expect, test } from 'bun:test'

import {
  formatFavoriteName,
  formatRideListDateTime,
  formatRideListDetails,
  suggestFavoriteName,
} from '@/modules/history/lib/rideFormat'

test('list date combines the ride time range with the readable calendar date', () => {
  const start = new Date(2026, 6, 10, 23, 30).getTime()
  const end = new Date(2026, 6, 10, 23, 34).getTime()

  expect(formatRideListDateTime(start, end)).toBe('23:30 – 23:34 · 10 Jul 2026')
})

test('list details use contextual duration units and keep the board last', () => {
  expect(formatRideListDetails(50 * 60_000, 1_820, 'Thor3')).toBe('50 min · 1.82 km · Thor3')
  expect(formatRideListDetails(83 * 60_000, 12_840, 'Very Long Board Name')).toBe(
    '1h 23m · 12.84 km · Very Long Board Name',
  )
})

test('short Favorite suggestions use rider-friendly parts of day', () => {
  const at = (day: number, hour: number) => new Date(2026, 6, day, hour).getTime()

  expect(suggestFavoriteName(at(10, 2), at(10, 3))).toBe('Night ride')
  expect(suggestFavoriteName(at(10, 7), at(10, 9))).toBe('Morning ride')
  expect(suggestFavoriteName(at(10, 13), at(10, 15))).toBe('Afternoon ride')
  expect(suggestFavoriteName(at(10, 20), at(11, 2))).toBe('Evening ride')
})

test('long Favorite suggestions describe the whole range', () => {
  const start = new Date(2026, 6, 10, 9).getTime()

  expect(suggestFavoriteName(start, start + 12 * 3_600_000)).toBe('Day ride')
  expect(suggestFavoriteName(start, start + 24 * 3_600_000)).toBe('All-day ride')
  expect(suggestFavoriteName(start, start + 40 * 3_600_000)).toBe('Multi-day ride')
})

test('a stored Favorite name wins over its generated suggestion', () => {
  const start = new Date(2026, 6, 10, 20).getTime()
  const end = start + 60 * 60_000

  expect(formatFavoriteName(null, start, end)).toBe('Evening ride')
  expect(formatFavoriteName('  ', start, end)).toBe('Evening ride')
  expect(formatFavoriteName(' Forest run ', start, end)).toBe('Forest run')
})
