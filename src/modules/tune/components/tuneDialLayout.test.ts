import { expect, test } from 'bun:test'
import { formatDisplayValue } from './tuneDialLayout'

test('ruler labels suppress arithmetic tails without losing meaningful precision', () => {
  expect(formatDisplayValue(0.7000000000000002, 16)).toBe('0.7')
  expect(formatDisplayValue(-0.30000000000000004, 17)).toBe('-0.3')
  expect(formatDisplayValue(0.022500000000000003, 18)).toBe('0.0225')
  expect(formatDisplayValue(0.123456, 6)).toBe('0.123456')
  expect(formatDisplayValue(2.34, 1)).toBe('2.3')
})
