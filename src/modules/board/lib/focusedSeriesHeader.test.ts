import { expect, test } from 'bun:test'

import { formatFocusedSeriesDetail, formatFocusedSeriesSpan } from './focusedSeriesHeader'

test('reports the covered window in minutes', () => {
  expect(formatFocusedSeriesSpan(600_000, 5)).toBe('Last 10 min')
})

test('short windows read in seconds', () => {
  expect(formatFocusedSeriesSpan(42_000, 5)).toBe('Last 42 s')
})

test('falls back to the configured window until data arrives', () => {
  expect(formatFocusedSeriesSpan(0, 5)).toBe('Last 5 min')
})

test('slow feeds keep one decimal so the rate is not rounded to a lie', () => {
  expect(formatFocusedSeriesDetail(120_000, 3.25)).toBe('Full resolution data at ~3.3 Hz')
})

test('drops the rate until it can be measured', () => {
  expect(formatFocusedSeriesDetail(120_000, 0)).toBe('Full resolution data')
})

test('says so while there is nothing to draw', () => {
  expect(formatFocusedSeriesDetail(0, 0)).toBe('Waiting for data')
})
