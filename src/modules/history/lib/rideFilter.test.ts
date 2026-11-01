import { describe, expect, test } from 'bun:test'

import {
  customRange,
  matchesRideFilter,
  presetRange,
  toRideHistoryFilter,
} from '@/modules/history/lib/rideFilter'

const local = (year: number, month: number, day: number, hour = 0) =>
  new Date(year, month - 1, day, hour).getTime()

describe('presetRange', () => {
  test('previous month crosses the year in January', () => {
    expect(presetRange('previousMonth', local(2026, 1, 15, 12))).toEqual({
      preset: 'previousMonth',
      fromMs: local(2025, 12, 1),
      toMs: local(2026, 1, 1),
    })
  })

  test('this month includes all of today', () => {
    const now = local(2026, 3, 3, 9)
    expect(presetRange('thisMonth', now)).toMatchObject({
      fromMs: local(2026, 3, 1),
      toMs: local(2026, 3, 4),
    })
  })
})

test('custom range covers whole days in either order', () => {
  expect(customRange(local(2026, 5, 9, 18), local(2026, 5, 2, 7))).toEqual({
    preset: 'custom',
    fromMs: local(2026, 5, 2),
    toMs: local(2026, 5, 10),
  })
})

test('favorites match by ride start and Board, with no Board meaning all', () => {
  const filter = toRideHistoryFilter({
    date: customRange(local(2026, 5, 2), local(2026, 5, 2)),
    boardIds: [],
    weather: [],
  })
  expect(filter).toEqual({ fromMs: local(2026, 5, 2), toMs: local(2026, 5, 3) })
  expect(
    matchesRideFilter({ startAtMs: local(2026, 5, 2, 23), boardId: null, weather: null }, filter),
  ).toBe(true)
  expect(
    matchesRideFilter({ startAtMs: local(2026, 5, 3), boardId: null, weather: null }, filter),
  ).toBe(false)
  expect(
    matchesRideFilter({ startAtMs: 0, boardId: 'gt', weather: null }, { boardIds: ['thor'] }),
  ).toBe(false)
})

test('favorites meet any picked weather condition, and no summary meets none', () => {
  const weather = (minTemperatureC: number, maxTemperatureC: number, rainMinutes: number) => ({
    icon: 'cloud-sun' as const,
    minTemperatureC,
    maxTemperatureC,
    maxGustKmh: null,
    rainMinutes,
  })
  const ride = (summary: ReturnType<typeof weather> | null) => ({
    startAtMs: 0,
    boardId: null,
    weather: summary,
  })
  expect(matchesRideFilter(ride(weather(3, 9, 0)), { weather: ['cold', 'rain'] })).toBe(true)
  expect(matchesRideFilter(ride(weather(12, 18, 4)), { weather: ['rain'] })).toBe(false)
  expect(matchesRideFilter(ride(weather(12, 18, 5)), { weather: ['rain'] })).toBe(true)
  expect(matchesRideFilter(ride(weather(20, 28, 0)), { weather: ['hot'] })).toBe(true)
  expect(matchesRideFilter(ride(null), { weather: ['cold'] })).toBe(false)
})
