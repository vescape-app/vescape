import { expect, test } from 'bun:test'

import {
  AXIS_WIDTH,
  CHART_GAP,
  computeChartRow,
  computeRowBands,
} from '@/components/charts/line/chartLayout'

test('both gutters are always reserved, so every chart shares one x scale', () => {
  const tall = computeChartRow({ width: 360, height: 48 })
  const short = computeChartRow({ width: 360, height: 40 })
  expect(tall.plot.x).toBe(AXIS_WIDTH)
  expect(short.plot.x).toBe(AXIS_WIDTH)
  expect(tall.plot.width).toBe(360 - AXIS_WIDTH * 2)
  expect(short.plot.width).toBe(tall.plot.width)
})

test('the label sits above the plot, inside the canvas', () => {
  const row = computeChartRow({ width: 360, height: 48 })
  expect(row.labelBaseline).toBeLessThanOrEqual(row.plot.y)
  expect(row.canvasHeight).toBe(row.plot.y + row.plot.height)
})

test('a chart narrower than its gutters collapses instead of going negative', () => {
  expect(computeChartRow({ width: 10, height: 40 }).plot.width).toBe(0)
})

test('touch bands follow the column down without overlapping', () => {
  const bands = computeRowBands([48, 40, 40])
  for (let i = 1; i < bands.length; i += 1) {
    expect(bands[i].top).toBeGreaterThanOrEqual(bands[i - 1].bottom + CHART_GAP)
  }
})
