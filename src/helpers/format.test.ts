import { describe, expect, test } from 'bun:test'

import { dutyPercent, fmtCompactCount, fmtDutyPercent, fmtTimeAgo } from './format'

describe('dutyPercent', () => {
  test('hides ReFloat idle quantization', () => {
    expect(dutyPercent(0.01)).toBe(0)
    expect(dutyPercent(-0.01, false)).toBe(0)
  })

  test('formats whole percent labels', () => {
    expect(fmtDutyPercent(0.024)).toBe('2%')
    expect(fmtDutyPercent(-0.024, false)).toBe('-2%')
  })
})

describe('fmtTimeAgo', () => {
  const now = 1_000_000_000_000

  test('unit boundaries', () => {
    expect(fmtTimeAgo(now - 30_000, now)).toBe('now')
    expect(fmtTimeAgo(now - 5 * 60_000, now)).toBe('5m ago')
    expect(fmtTimeAgo(now - 59 * 60_000, now)).toBe('59m ago')
    expect(fmtTimeAgo(now - 2 * 3_600_000, now)).toBe('2h ago')
    expect(fmtTimeAgo(now - 3 * 86_400_000, now)).toBe('3d ago')
  })

  test('clock skew never yields negative age', () => {
    expect(fmtTimeAgo(now + 60_000, now)).toBe('now')
  })
})

describe('fmtCompactCount', () => {
  test('keeps small counts exact and abbreviates larger ones', () => {
    expect(fmtCompactCount(0)).toBe('0')
    expect(fmtCompactCount(999)).toBe('999')
    expect(fmtCompactCount(1000)).toBe('1.0k')
    expect(fmtCompactCount(1240)).toBe('1.2k')
    expect(fmtCompactCount(12_400)).toBe('12k')
    expect(fmtCompactCount(100_000)).toBe('100k')
    expect(fmtCompactCount(999_999)).toBe('1.0M')
    expect(fmtCompactCount(2_500_000)).toBe('2.5M')
  })

  test('never renders a negative or fractional count', () => {
    expect(fmtCompactCount(-5)).toBe('0')
    expect(fmtCompactCount(3.7)).toBe('4')
  })
})
