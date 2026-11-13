import { expect, test } from 'bun:test'

import {
  formatFavoriteName,
  formatRideListDetails,
  formatRideTime,
  suggestFavoriteName,
} from '@/modules/history/lib/rideFormat'

test('list details use contextual duration units', () => {
  expect(formatRideListDetails(50 * 60_000, 1_820)).toBe('50 min · 1.82 km')
  expect(formatRideListDetails(83 * 60_000, 12_840)).toBe('1h 23m · 12.84 km')
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

test('a ride still being recorded ends at now instead of a clock time', () => {
  const start = new Date(2026, 7, 24, 8, 12).getTime()
  const end = start + 30 * 60_000

  expect(formatRideTime(start, end, true)).toBe('08:12 – now')
  expect(formatRideTime(start, end)).toBe('08:12 – 08:42')
})

test('existing ride totals use miles even below the nearby-distance cutoff', () => {
  const record = Object.freeze({ distanceM: 80, durationMs: 120_000 })
  expect(formatRideListDetails(record.durationMs, record.distanceM, 'mi')).toBe('2 min · 0.05 mi')
  expect(formatRideListDetails(record.durationMs, record.distanceM, 'km')).toBe('2 min · 0.08 km')
  expect(formatRideListDetails(record.durationMs, null, 'mi')).toBe('2 min')
  expect(formatRideListDetails(0, 0, 'mi')).toBe('1 min · 0.00 mi')
  expect(record.distanceM).toBe(80)
})

test('12h ride ranges identify noon, midnight and live endpoints', () => {
  const beforeNoon = new Date(2026, 10, 13, 11, 45).getTime()
  const afterNoon = new Date(2026, 10, 13, 12, 15).getTime()
  const midnight = new Date(2026, 10, 14, 0, 0).getTime()
  expect(formatRideTime(beforeNoon, afterNoon, false, '12h')).toBe('11:45 AM – 12:15 PM')
  expect(formatRideTime(afterNoon, midnight, false, '12h')).toBe('12:15 PM – 12:00 AM')
  expect(formatRideTime(afterNoon, midnight, true, '12h')).toBe('12:15 PM – now')
})
