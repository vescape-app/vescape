import { expect, test } from 'bun:test'

import { buildFocusedExcludedRanges } from './useLiveMetric'

test('single avg_speed key builds low_speed bands, merging spans within the gap', () => {
  const ranges = buildFocusedExcludedRanges({ avg_speed: [0, 100, 1500, 1800] }, ['avg_speed'])
  expect(ranges).toEqual([{ startMs: 0, endMs: 1800, reason: 'low_speed' }])
})

test('multi-key request unions spans under the free_spin reason', () => {
  const ranges = buildFocusedExcludedRanges({ avg_speed: [0, 100], max_speed: [200, 400] }, [
    'avg_speed',
    'max_speed',
  ])
  expect(ranges).toEqual([{ startMs: 0, endMs: 400, reason: 'free_spin' }])
})

test('spans separated by more than the merge gap stay distinct', () => {
  const ranges = buildFocusedExcludedRanges({ max_duty: [0, 100, 5000, 5200] }, ['max_duty'])
  expect(ranges).toEqual([
    { startMs: 0, endMs: 100, reason: 'free_spin' },
    { startMs: 5000, endMs: 5200, reason: 'free_spin' },
  ])
})

test('ignores keys not present in the exclusions payload', () => {
  expect(buildFocusedExcludedRanges({ max_duty: [0, 100] }, ['avg_speed', 'max_speed'])).toEqual([])
})
