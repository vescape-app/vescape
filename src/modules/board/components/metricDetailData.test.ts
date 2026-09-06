import { expect, test } from 'bun:test'

import { toChartBands, toChartSeries } from '@/modules/board/components/metricDetailData'

test('toChartSeries splits live samples into parallel arrays', () => {
  const series = toChartSeries([
    { ts: 1_000, value: 12 },
    { ts: 2_000, value: 18 },
  ])

  expect(series).toEqual({ ts: [1_000, 2_000], vs: [12, 18] })
})

test('toChartSeries drops samples older than the live window', () => {
  const series = toChartSeries(
    [
      { ts: 1_000, value: 1 },
      { ts: 5_000, value: 2 },
      { ts: 9_000, value: 3 },
    ],
    5_000,
  )

  expect(series).toEqual({ ts: [5_000, 9_000], vs: [2, 3] })
})

test('toChartBands colors free-spin stretches apart from the rest', () => {
  const bands = toChartBands([
    { startMs: 0, endMs: 1, reason: 'free_spin' },
    { startMs: 2, endMs: 3, reason: 'low_speed' },
  ])

  expect(bands).toHaveLength(2)
  expect(bands?.[0].color).not.toBe(bands?.[1].color)
  expect(bands?.every((band) => band.fill === 'floor')).toBe(true)
})
