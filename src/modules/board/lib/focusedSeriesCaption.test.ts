import { expect, test } from 'bun:test'

import { formatFocusedSeriesCaption } from './focusedSeriesCaption'

test('reports the window in minutes with a rounded rate', () => {
  expect(formatFocusedSeriesCaption(600_000, 19.4)).toBe(
    'Full resolution data from last 10 min at ~19 Hz',
  )
})

test('short windows read in seconds', () => {
  expect(formatFocusedSeriesCaption(42_000, 20)).toBe(
    'Full resolution data from last 42 s at ~20 Hz',
  )
})

test('slow feeds keep one decimal so the rate is not rounded to a lie', () => {
  expect(formatFocusedSeriesCaption(120_000, 3.25)).toBe(
    'Full resolution data from last 2 min at ~3.3 Hz',
  )
})

test('drops the rate until it can be measured', () => {
  expect(formatFocusedSeriesCaption(120_000, 0)).toBe('Full resolution data from last 2 min')
})

test('no caption without data', () => {
  expect(formatFocusedSeriesCaption(0, 0)).toBeNull()
})
