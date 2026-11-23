import { describe, expect, test } from 'bun:test'
import {
  formatClock,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatShortDate,
  formatTimeOfDay,
} from './time'

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
  test('formats timestamps in local time and respects date and time formats', () => {
    const timestamp = new Date(2026, 10, 13, 14, 5, 9).getTime()
    expect(formatClock(timestamp)).toBe('14:05')
    expect(formatClock(timestamp, true, '12h')).toBe('2:05:09 PM')
    expect(formatDateTime(timestamp, '12h')).toBe('13 Nov 2026 2:05:09 PM')
    expect(formatDateTime(timestamp, '12h', 'mdy')).toBe('Nov 13, 2026 2:05:09 PM')
    expect(formatDateTime(timestamp, '24h', 'ymd')).toBe('2026-11-13 14:05:09')
  })
})

describe('date presentation', () => {
  test('formats single dates, short dates, and ranges in dmy, mdy, and ymd', () => {
    const mar28 = new Date(2026, 2, 28).getTime()
    const mar30 = new Date(2026, 2, 30).getTime()
    const apr2 = new Date(2026, 3, 2).getTime()

    expect(formatDate(mar28, 'dmy')).toBe('28 Mar 2026')
    expect(formatDate(mar28, 'mdy')).toBe('Mar 28, 2026')
    expect(formatDate(mar28, 'ymd')).toBe('2026-03-28')

    expect(formatShortDate(mar28, 'dmy')).toBe('28 Mar')
    expect(formatShortDate(mar28, 'mdy')).toBe('Mar 28')
    expect(formatShortDate(mar28, 'ymd')).toBe('03-28')

    expect(formatDateRange(mar28, mar28, 'mdy')).toBe('Mar 28, 2026')
    expect(formatDateRange(mar28, mar30, 'dmy')).toBe('28–30 Mar 2026')
    expect(formatDateRange(mar28, mar30, 'mdy')).toBe('Mar 28–30, 2026')
    expect(formatDateRange(mar28, mar30, 'ymd')).toBe('2026-03-28 – 2026-03-30')
    expect(formatDateRange(mar28, apr2, 'dmy')).toBe('28 Mar – 2 Apr 2026')
    expect(formatDateRange(mar28, apr2, 'mdy')).toBe('Mar 28 – Apr 2, 2026')
    expect(formatDateRange(mar28, apr2, 'ymd')).toBe('2026-03-28 – 2026-04-02')
  })
})
