import { expect, test } from 'bun:test'

import { AXIS_WIDTH, CHART_GAP, computeChartLayout } from '@/components/charts/line/chartLayout'

test('both gutters are always reserved, so every plot shares one x scale', () => {
  const withRight = computeChartLayout({ heights: [48, 40], width: 360 })
  for (const plot of withRight.plots) {
    expect(plot.x).toBe(AXIS_WIDTH)
    expect(plot.width).toBe(360 - AXIS_WIDTH * 2)
  }
})

test('plots stack downward without overlapping', () => {
  const layout = computeChartLayout({ heights: [48, 40, 40], width: 360 })
  for (let i = 1; i < layout.plots.length; i += 1) {
    const previous = layout.plots[i - 1]
    expect(layout.plots[i].y).toBeGreaterThanOrEqual(previous.y + previous.height + CHART_GAP)
  }
  const last = layout.plots.at(-1)!
  expect(layout.canvasHeight).toBeGreaterThan(last.y + last.height)
})

test('each label sits above its own plot', () => {
  const layout = computeChartLayout({ heights: [48, 40], width: 360 })
  layout.labelBaselines.forEach((baseline, index) => {
    expect(baseline).toBeLessThanOrEqual(layout.plots[index].y)
    if (index > 0) {
      const previous = layout.plots[index - 1]
      expect(baseline).toBeGreaterThan(previous.y + previous.height)
    }
  })
})

test('a plot narrower than its gutters collapses instead of going negative', () => {
  const layout = computeChartLayout({ heights: [40], width: 10 })
  expect(layout.plots[0].width).toBe(0)
})
