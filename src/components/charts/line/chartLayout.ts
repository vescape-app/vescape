import type { ChartPlotBox } from '@/components/charts/line/types'

/** Gutter reserved for one value axis. Sized for four mono digits at {@link AXIS_FONT_SIZE}. */
export const AXIS_WIDTH = 34
export const AXIS_FONT_SIZE = 8
export const LABEL_FONT_SIZE = 10
/** Strip above each plot carrying its label. */
export const LABEL_HEIGHT = 14
/** Strip below the whole stack carrying the shared time axis. */
export const TIME_AXIS_HEIGHT = 12
/** Vertical space between stacked plots. */
export const CHART_GAP = 8

export interface ChartLayoutInput {
  heights: number[]
  width: number
  hasRightAxis: boolean
}

export interface ChartLayout {
  plots: ChartPlotBox[]
  /** Label baselines, one per plot, in canvas coordinates. */
  labelBaselines: number[]
  canvasHeight: number
  timeAxisBaseline: number
}

/**
 * Place every plot of a stack in one canvas. Gutters are decided once for the whole stack, so
 * charts with and without a right-hand axis still share an x scale — the misalignment a
 * per-chart layout invites is not expressible here.
 */
export function computeChartLayout({
  heights,
  width,
  hasRightAxis,
}: ChartLayoutInput): ChartLayout {
  const plotX = AXIS_WIDTH
  const plotWidth = Math.max(0, width - AXIS_WIDTH - (hasRightAxis ? AXIS_WIDTH : 0))
  const plots: ChartPlotBox[] = []
  const labelBaselines: number[] = []
  let y = 0

  for (let i = 0; i < heights.length; i += 1) {
    if (i > 0) y += CHART_GAP
    // Baseline sits just above the plot, leaving the font's descender clear of the top line.
    labelBaselines.push(y + LABEL_HEIGHT - 4)
    y += LABEL_HEIGHT
    plots.push({ x: plotX, y, width: plotWidth, height: heights[i] })
    y += heights[i]
  }

  return {
    plots,
    labelBaselines,
    canvasHeight: y + TIME_AXIS_HEIGHT,
    timeAxisBaseline: y + AXIS_FONT_SIZE + 2,
  }
}
