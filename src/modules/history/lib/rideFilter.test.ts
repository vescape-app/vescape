import { describe, expect, test } from 'bun:test'
import type { RideWeather } from 'vescape-core'

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

test('favorite weather: either within a group, both across groups, none without a summary', () => {
  const weather = (
    icon: RideWeather['icon'],
    minTemperatureC: number,
    rainMinutes = 0,
    maxGustKmh: number | null = null,
  ): RideWeather => ({
    icon,
    minTemperatureC,
    maxTemperatureC: minTemperatureC + 4,
    maxGustKmh,
    rainMinutes,
  })
  const ride = (summary: RideWeather | null) => ({ startAtMs: 0, boardId: null, weather: summary })
  const coldClearNight = ride(weather('moon', 2))
  expect(matchesRideFilter(coldClearNight, { weather: ['rain', 'clear'] })).toBe(true)
  expect(matchesRideFilter(coldClearNight, { weather: ['clear', 'cold', 'night'] })).toBe(true)
  expect(matchesRideFilter(coldClearNight, { weather: ['rain', 'cold'] })).toBe(false)
  expect(matchesRideFilter(ride(weather('cloud-rain', 12, 4)), { weather: ['rain'] })).toBe(false)
  expect(matchesRideFilter(ride(weather('cloud', 12, 5, 40)), { weather: ['rain', 'windy'] })).toBe(
    true,
  )
  expect(matchesRideFilter(ride(null), { weather: ['cold'] })).toBe(false)
})
