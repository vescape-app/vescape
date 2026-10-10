import type { ChartPlotBand, ChartPlotBox } from '@/components/charts/line/types'

/** Gutter reserved for one value axis. Sized for four mono digits at {@link AXIS_FONT_SIZE}. */
export const AXIS_WIDTH = 34
export const AXIS_FONT_SIZE = 8
export const LABEL_FONT_SIZE = 10
/** Strip above each plot carrying its label. */
export const LABEL_HEIGHT = 14
/** What an unlabelled plot keeps above it, so the line never touches whatever sits above it. */
export const PLOT_TOP_PAD = 8
/** Strip below the whole stack carrying the shared time axis. */
export const TIME_AXIS_HEIGHT = 12
/** Vertical space between stacked charts. */
export const CHART_GAP = 8
/** Baseline of the time axis, in its own canvas. */
export const TIME_AXIS_BASELINE = AXIS_FONT_SIZE + 2

/**
 * Width left for the plot once both gutters are taken. Both are always reserved, whether or not
 * any chart currently carries a right-hand axis: the stack shares one x scale, and a gutter that
 * appeared with the battery chart would push every other line out of alignment with it.
 */
export function plotWidthFor(width: number): number {
  return Math.max(0, width - AXIS_WIDTH * 2)
}

/**
 * Everything a stack of `chartCount` charts spends on something other than plot: a label strip per
 * chart, the gaps between the rows and before the time axis, and the axis itself. Sizing charts to
 * fill a screen means dividing what is left of the height by this.
 */
export function stackChromeHeight(chartCount: number): number {
  return chartCount * (LABEL_HEIGHT + CHART_GAP) + TIME_AXIS_HEIGHT
}

export interface ChartRowInput {
  width: number
  height: number
  /** A chart without a label spends no height on the strip above the plot. */
  hasLabel?: boolean
}

export interface ChartRowLayout {
  plot: ChartPlotBox
  /** Label baseline, in the row's own canvas coordinates. */
  labelBaseline: number
  canvasHeight: number
}

/**
 * Place one chart in its own canvas.
 *
 * Every chart is drawn at the same origin, so a chart's geometry does not depend on what else is
 * on screen: opening or closing a neighbour is a React Native layout change and leaves this
 * canvas's picture untouched. Placing the stack is ordinary flex layout, not arithmetic.
 */
export function computeChartRow({ width, height, hasLabel = true }: ChartRowInput): ChartRowLayout {
  const strip = hasLabel ? LABEL_HEIGHT : PLOT_TOP_PAD
  return {
    // Baseline sits just above the plot, leaving the font's descender clear of the top line.
    labelBaseline: strip - 4,
    plot: { x: AXIS_WIDTH, y: strip, width: plotWidthFor(width), height },
    canvasHeight: strip + height,
  }
}

/**
 * Vertical bounds of each plot in the column's coordinates, so one gesture over the whole stack
 * can still say which chart a touch landed on.
 */
export function computeRowBands(heights: number[]): ChartPlotBand[] {
  const bands: ChartPlotBand[] = []
  let y = 0
  for (let i = 0; i < heights.length; i += 1) {
    if (i > 0) y += CHART_GAP
    y += LABEL_HEIGHT
    bands.push({ top: y, bottom: y + heights[i] })
    y += heights[i]
  }
  return bands
}
