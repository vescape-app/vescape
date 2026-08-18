import { expect, test } from 'bun:test'

import { computeAutoRangeFromValues, toExcludedRanges } from '@/components/charts/chartMath'

test('a baseline holds the axis unless the ride overshoots it', () => {
  const inside = computeAutoRangeFromValues([0, 41.6], {
    includeZero: true,
    minSpan: 10,
    paddingRatio: 0.1,
    baseline: { min: 0, max: 50 },
  })
  expect(inside).toEqual({ min: 0, max: 50 })

  const over = computeAutoRangeFromValues([0, 62], {
    includeZero: true,
    minSpan: 10,
    paddingRatio: 0.1,
    baseline: { min: 0, max: 50 },
  })
  expect(over.min).toBe(0)
  expect(over.max).toBeGreaterThan(62)
})

test('snap rounds the axis outward and keeps a floor of zero', () => {
  const speed = computeAutoRangeFromValues([0, 57], {
    includeZero: true,
    minSpan: 10,
    paddingRatio: 0.1,
    snap: true,
  })
  expect(speed).toEqual({ min: 0, max: 70 })
})

test('minSpan widens a flat series instead of only scaling its padding', () => {
  const flat = computeAutoRangeFromValues([50.1, 50.2], { minSpan: 5 })
  expect(flat.max - flat.min).toBeGreaterThanOrEqual(5)
})

test('toExcludedRanges filters by metric map and merges nearby ranges', () => {
  const ranges = toExcludedRanges(
    [
      { startMs: 1_000, endMs: 2_000, reason: 'low_speed', metrics: { avg_speed: true } },
      { startMs: 3_000, endMs: 4_000, reason: 'low_speed', metrics: { avg_speed: true } },
      { startMs: 8_000, endMs: 9_000, reason: 'free_spin', metrics: { max_duty: true } },
    ],
    'avg_speed',
  )

  expect(ranges).toEqual([{ startMs: 1_000, endMs: 4_000, reason: 'low_speed' }])
})

test('toExcludedRanges supports multi-metric filters', () => {
  const ranges = toExcludedRanges(
    [
      { startMs: 1_000, endMs: 2_000, reason: 'low_speed', metrics: { avg_speed: true } },
      { startMs: 7_000, endMs: 8_000, reason: 'free_spin', metrics: { max_speed: true } },
      { startMs: 12_000, endMs: 13_000, reason: 'free_spin', metrics: { max_duty: true } },
    ],
    ['avg_speed', 'max_speed'],
  )

  expect(ranges).toEqual([
    { startMs: 1_000, endMs: 2_000, reason: 'low_speed' },
    { startMs: 7_000, endMs: 8_000, reason: 'free_spin' },
  ])
})

test('toExcludedRanges does not merge nearby ranges with different reasons', () => {
  const ranges = toExcludedRanges(
    [
      { startMs: 1_000, endMs: 2_000, reason: 'low_speed', metrics: { avg_speed: true } },
      { startMs: 2_200, endMs: 3_000, reason: 'free_spin', metrics: { avg_speed: true } },
    ],
    'avg_speed',
  )

  expect(ranges).toEqual([
    { startMs: 1_000, endMs: 2_000, reason: 'low_speed' },
    { startMs: 2_200, endMs: 3_000, reason: 'free_spin' },
  ])
})
