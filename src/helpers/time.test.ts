import { describe, expect, test } from 'bun:test'
import { formatClock, formatDateTime, formatTimeOfDay } from './time'

describe('clock presentation', () => {
  test('distinguishes midnight, noon and afternoon in both formats', () => {
    for (const [minutes, full, twelve] of [
      [0, '00:00', '12:00 AM'],
      [12 * 60, '12:00', '12:00 PM'],
      [14 * 60 + 5, '14:05', '2:05 PM'],
      [23 * 60 + 59, '23:59', '11:59 PM'],
    ] as const) {
      expect(formatTimeOfDay(minutes, '24h')).toBe(full)
      expect(formatTimeOfDay(minutes, '12h')).toBe(twelve)
    }
  })
  test('wraps forecast-local minutes without device timezone conversion', () => {
    expect(formatTimeOfDay(1440)).toBe('00:00')
    expect(formatTimeOfDay(1505, '12h')).toBe('1:05 AM')
    expect(formatTimeOfDay(-1, '12h')).toBe('11:59 PM')
  })
  test('formats timestamps in local time and keeps seconds before the period', () => {
    const timestamp = new Date(2026, 10, 13, 14, 5, 9).getTime()
    expect(formatClock(timestamp)).toBe('14:05')
    expect(formatClock(timestamp, true, '12h')).toBe('2:05:09 PM')
    expect(formatDateTime(timestamp, '12h')).toBe(
      `${new Date(timestamp).toLocaleDateString()} 2:05:09 PM`,
    )
  })
})
