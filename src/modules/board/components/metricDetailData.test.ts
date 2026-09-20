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

test('unit presentation preserves samples, thresholds, ranges, and chart identity', async () => {
  const { toLiveChart, presentLiveChart } = await import('./metricDetailData')
  const { telemetry, presentTelemetryMetric } = await import('../constants/telemetry')
  const data = { ts: [1000, 2000], vs: [16.09344, 32.18688] }
  const range = { min: 0, max: 50 }
  const thresholds = [40]
  const canonical = toLiveChart({ key: 'speed', metric: telemetry.speed, data, range, thresholds })
  const imperial = presentLiveChart(canonical, 'imperial')
  expect(imperial.series[0].data).toBe(data)
  expect(imperial.left.range).toBe(range)
  expect(imperial.thresholds).toBe(thresholds)
  expect(imperial.key).toBe(canonical.key)
  expect(imperial.series[0].unit).toBe('mph')
  expect(imperial.left.displayScale).toBe(imperial.series[0].displayScale)
  expect(data.vs[0] * imperial.series[0].displayScale!).toBeCloseTo(10)
  expect(presentTelemetryMetric(telemetry.speed, 'imperial').formatWithUnit(-16.09344)).toBe(
    '10 mph',
  )
  expect(telemetry.speed.unit).toBe('km/h')
  expect(presentLiveChart(canonical, 'metric').series[0].data).toBe(data)
})
