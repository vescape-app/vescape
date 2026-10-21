import { expect, test } from 'bun:test'
import { parseManualTuneValue } from './manualTuneValue'

test('manual entry preserves values between ruler steps and supports decimal commas and signs', () => {
  expect(parseManualTuneValue('2.3', 1)).toEqual({ value: 2.3, error: null })
  expect(parseManualTuneValue('-40', 0)).toEqual({ value: -40, error: null })
  expect(parseManualTuneValue('0,026', 3)).toEqual({ value: 0.026, error: null })
  expect(parseManualTuneValue('2.300', 1)).toEqual({ value: 2.3, error: null })
})

test('rejects malformed and excessive-precision input without clamping', () => {
  for (const text of ['', '-', '.', '2abc', '1.2.3', 'Infinity', '2.34']) {
    expect(parseManualTuneValue(text, 1).error).not.toBeNull()
  }
  expect(parseManualTuneValue('200.5', 0).error).toBe('Enter a whole number.')
})

test('manual values outside the ruler range are preserved for warning-only confirmation', () => {
  expect(parseManualTuneValue('6', 1)).toEqual({ value: 6, error: null })
  expect(parseManualTuneValue('-1', 1)).toEqual({ value: -1, error: null })
})
