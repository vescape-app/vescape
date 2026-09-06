import { describe, expect, test } from 'bun:test'
import { DASH } from '@/helpers/format'
import {
  formatDistance,
  formatDuration,
  formatEnergy,
  formatMonthLabel,
  getAdjacentMonths,
  type ProfileMonth,
} from '@/modules/profile/lib/profileStats'

describe('profile stat formatting', () => {
  test('formats distance in meters and kilometers', () => {
    expect(formatDistance(null)).toBe(DASH)
    expect(formatDistance(800)).toBe('800 m')
    expect(formatDistance(12_345)).toBe('12.3 km')
  })

  test('formats ride duration compactly', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(2 * 60 * 60_000 + 15 * 60_000)).toBe('2h 15m')
  })

  test('formats energy', () => {
    expect(formatEnergy(null)).toBe(DASH)
    expect(formatEnergy(42.4)).toBe('42 Wh')
    expect(formatEnergy(1234)).toBe('1.2 kWh')
  })

  test('finds adjacent months from newest-first list', () => {
    const months: ProfileMonth[] = [
      { year: 2024, month: 6 },
      { year: 2024, month: 5 },
      { year: 2024, month: 3 },
    ]
    expect(getAdjacentMonths(months, { year: 2024, month: 5 })).toEqual({
      previous: { year: 2024, month: 3 },
      next: { year: 2024, month: 6 },
    })
  })

  test('formats month label', () => {
    expect(formatMonthLabel({ year: 2024, month: 5 }, 'en-US')).toBe('May 2024')
  })
})
