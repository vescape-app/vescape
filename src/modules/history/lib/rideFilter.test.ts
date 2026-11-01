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
  })
  expect(filter).toEqual({ fromMs: local(2026, 5, 2), toMs: local(2026, 5, 3) })
  expect(matchesRideFilter({ startAtMs: local(2026, 5, 2, 23), boardId: null }, filter)).toBe(true)
  expect(matchesRideFilter({ startAtMs: local(2026, 5, 3), boardId: null }, filter)).toBe(false)
  expect(matchesRideFilter({ startAtMs: 0, boardId: 'gt' }, { boardIds: ['thor'] })).toBe(false)
})
