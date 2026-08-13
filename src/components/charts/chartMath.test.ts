import { expect, test } from 'bun:test'

import {
  computeAutoRange,
  computeAutoRangeFromValues,
  findNearestChartPointAtX,
  getChartPosition,
  getChartAlertMarkers,
  getChartTimeRangeBands,
  getChartTimeLabels,
  splitChartLineSegments,
  type TelemetryChartPoint,
  toExcludedRanges,
} from '@/components/charts/chartMath'

const base = new Date('2026-01-01T00:00:00.000Z').getTime()

const points: TelemetryChartPoint[] = [
  { date: new Date(base + 0), value: 10 },
  { date: new Date(base + 1_000), value: 30 },
  { date: new Date(base + 2_000), value: 20 },
]

test('getChartPosition maps higher values upward', () => {
  const range = { y: { min: 0, max: 40 } }
  const low = getChartPosition(points, points[0], range, 100, 50)
  const high = getChartPosition(points, points[1], range, 100, 50)
  expect(low).not.toBeNull()
  expect(high).not.toBeNull()
  expect(high!.y).toBeLessThan(low!.y)
})

test('getChartPosition clamps inside bounds', () => {
  const range = { y: { min: 0, max: 100 } }
  const out: TelemetryChartPoint = { date: new Date(base + 5_000), value: 200 }
  const pos = getChartPosition(points, out, range, 100, 50)
  expect(pos).toEqual({ x: 100, y: 0 })
})

test('alert markers preserve visible line positions', () => {
  const markers = getChartAlertMarkers([50, 40, 30, 20, 15, 10, 5], { y: { min: 0, max: 100 } }, 80)

  expect(markers.map((marker) => marker.value)).toEqual([50, 40, 30, 20, 15, 10, 5])
  expect(markers.every((marker) => marker.y >= 0 && marker.y <= 80)).toBe(true)
})

test('alert markers omit values outside the visible chart range', () => {
  expect(
    getChartAlertMarkers([-1, 20, 120], { y: { min: 0, max: 100 } }, 80).map(
      (marker) => marker.value,
    ),
  ).toEqual([20])
})

test('chart time-range bands clip to the visible domain and ignore outside ranges', () => {
  expect(
    getChartTimeRangeBands(
      points,
      [
        { startMs: base - 1_000, endMs: base + 500, id: 'left' },
        { startMs: base + 1_500, endMs: base + 3_000, id: 'right' },
        { startMs: base + 3_000, endMs: base + 4_000, id: 'outside' },
      ],
      100,
    ),
  ).toEqual([
    { startMs: base - 1_000, endMs: base + 500, id: 'left', x: 0, width: 25 },
    { startMs: base + 1_500, endMs: base + 3_000, id: 'right', x: 75, width: 25 },
  ])
})

test('findNearestChartPointAtX picks nearest and clamps x', () => {
  expect(findNearestChartPointAtX(points, 0, 100)).toEqual(points[0])
  expect(findNearestChartPointAtX(points, 50, 100)).toEqual(points[1])
  expect(findNearestChartPointAtX(points, 100, 100)).toEqual(points[2])
  expect(findNearestChartPointAtX(points, -1_000, 100)).toEqual(points[0])
  expect(findNearestChartPointAtX(points, 1_000, 100)).toEqual(points[2])
})

test('history chart time labels use local clock time', () => {
  const historyPoints = [
    { date: new Date(2026, 6, 10, 17, 15), value: 10 },
    { date: new Date(2026, 6, 10, 17, 19), value: 20 },
  ]

  expect(getChartTimeLabels(historyPoints, undefined, 'clock')).toEqual({
    start: '17:15',
    end: '17:19',
  })
})

test('live chart time labels remain relative to now', () => {
  expect(getChartTimeLabels(points, undefined, 'relative')).toEqual({
    start: '-2s',
    end: 'now',
  })
})

test('computeAutoRange supports zero include and min span', () => {
  const positive = [
    { date: new Date(base), value: 12 },
    { date: new Date(base + 1_000), value: 18 },
  ]
  const range = computeAutoRange(positive, {
    includeZero: true,
    minSpan: 10,
    paddingRatio: 0.1,
  })
  expect(range.y.min).toBeLessThanOrEqual(0)
  expect(range.y.max - range.y.min).toBeGreaterThanOrEqual(11)
})

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

test('splitChartLineSegments keeps continuous data in one segment', () => {
  const range = { y: { min: 0, max: 40 } }
  const segments = splitChartLineSegments(points, range, 100, 50)
  expect(segments).toHaveLength(1)
  expect(segments[0]).toHaveLength(3)
})

test('splitChartLineSegments breaks line on large telemetry gap', () => {
  const gapPoints: TelemetryChartPoint[] = [
    { date: new Date(base + 0), value: 10 },
    { date: new Date(base + 1_000), value: 12 },
    { date: new Date(base + 2_000), value: 14 },
    { date: new Date(base + 10_000), value: 20 },
    { date: new Date(base + 11_000), value: 22 },
  ]
  const range = { y: { min: 0, max: 30 } }
  const segments = splitChartLineSegments(gapPoints, range, 100, 50)
  expect(segments).toHaveLength(2)
  expect(segments[0]).toHaveLength(3)
  expect(segments[1]).toHaveLength(2)
})

test('a sparsely sampled stretch survives as one-sample runs instead of vanishing', () => {
  // Dense 50ms block, then samples seconds apart: every sparse neighbour exceeds the gap
  // threshold, so each is its own run. Dropping them would blank the whole stretch.
  const points: TelemetryChartPoint[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ date: new Date(1000 + i * 50), value: 4 })),
    { date: new Date(9_000), value: 3 },
    { date: new Date(14_000), value: 3 },
    { date: new Date(20_000), value: 3 },
  ]
  const runs = splitChartLineSegments(points, { y: { min: 0, max: 10 } }, 100, 50, 30_000)
  expect(runs.map((run) => run.length)).toEqual([6, 1, 1, 1])
})
