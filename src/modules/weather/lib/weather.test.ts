import { describe, expect, test } from 'bun:test'

import { formatHour } from '@/modules/weather/lib/weather'

describe('forecast hour labels', () => {
  test('formats a minute-of-day without touching the device timezone', () => {
    expect(formatHour(14 * 60)).toBe('14:00')
    expect(formatHour(0)).toBe('0:00')
    expect(formatHour(23 * 60 + 30)).toBe('23:30')
  })

  test('wraps a minute-of-day that ran past midnight', () => {
    expect(formatHour(24 * 60)).toBe('0:00')
    expect(formatHour(25 * 60 + 15)).toBe('1:15')
  })
})
