import { expect, test } from 'bun:test'

import {
  ALL_CHART_METRICS,
  EXTRA_CHART_METRICS,
  PANEL_CHART_METRICS,
  OPTIONAL_CHART_METRICS,
  toggleOptionalChartMetric,
  type ChartToggleMetric,
} from '@/modules/history/components/historyChartMetrics'

test('optional chart tabs keep the requested order', () => {
  expect(OPTIONAL_CHART_METRICS.map((metric) => metric.key)).toEqual([
    'duty',
    'battery',
    'tempMotor',
    'tempController',
    'motorCurrent',
    'batteryCurrent',
  ])
})

test('toggling an optional metric adds and removes it', () => {
  const enabledDuty = toggleOptionalChartMetric(new Set<ChartToggleMetric>(), 'duty')
  expect(enabledDuty.has('duty')).toBe(true)

  const enabledBattery = toggleOptionalChartMetric(enabledDuty, 'battery')
  expect(enabledBattery.has('battery')).toBe(true)

  const disabledDuty = toggleOptionalChartMetric(enabledBattery, 'duty')
  expect(disabledDuty.has('duty')).toBe(false)
})

test('chart-only metrics stay out of the map-colourable set', () => {
  const mapKeys = new Set<string>(OPTIONAL_CHART_METRICS.map((metric) => metric.key))
  for (const metric of EXTRA_CHART_METRICS) expect(mapKeys.has(metric.key)).toBe(false)
})

test('toggling a chart-only metric works alongside a map metric', () => {
  const enabled = toggleOptionalChartMetric(
    toggleOptionalChartMetric(new Set<ChartToggleMetric>(), 'duty'),
    'altitude',
  )
  expect(enabled.has('duty')).toBe(true)
  expect(enabled.has('altitude')).toBe(true)
})

test('the ride panel offers speed and a short list, the full-screen page offers everything', () => {
  expect(PANEL_CHART_METRICS.map((metric) => metric.key)).toEqual([
    'speed',
    'duty',
    'battery',
    'tempMotor',
    'tempController',
  ])
  expect(ALL_CHART_METRICS.length).toBe(
    1 + OPTIONAL_CHART_METRICS.length + EXTRA_CHART_METRICS.length,
  )
})
