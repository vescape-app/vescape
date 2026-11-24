import { expect, test } from 'bun:test'
import { formatTuneFieldValue, formatTuneValue, tuneDisplayScale, tuneDisplayValue } from './fields'

test('formats numeric, boolean, and enum tune field values', () => {
  expect(formatTuneValue(12.5)).toBe('12.5')
  expect(formatTuneValue(true)).toBe('On')
  expect(formatTuneValue(false)).toBe('Off')
  expect(
    formatTuneFieldValue({
      id: 'mode',
      value: 1,
      displayScale: 1,
      enumNames: ['Off', 'Sport', 'Race'],
    }),
  ).toBe('Sport')
})

test('applies overlay display scale for percentage fields like atr_speed_boost', () => {
  expect(tuneDisplayScale('atr_speed_boost')).toBe(100)
  expect(tuneDisplayValue('atr_speed_boost', 0.25)).toBe(25)
  expect(tuneDisplayScale('kp')).toBe(1)
})
