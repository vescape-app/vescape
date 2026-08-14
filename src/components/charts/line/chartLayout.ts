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
  /**
   * Height of the drawing surface, when it is larger than this stack needs. The stack is placed
   * against its bottom edge and the surplus is left empty above.
   */
  surfaceHeight?: number
}

export interface ChartLayout {
  plots: ChartPlotBox[]
  /** Label baselines, one per plot, in canvas coordinates. */
  labelBaselines: number[]
  /** What this stack needs — the height of the box it should be given. */
  canvasHeight: number
  /** What it is drawn on, which is never smaller. */
  surfaceHeight: number
  timeAxisBaseline: number
}

/**
 * Place every plot of a stack in one canvas. Both gutters are always reserved, whether or not any
 * chart currently carries a right-hand axis: the stack shares one x scale, and a gutter that
 * appears with the battery chart would otherwise resize — and re-path — every line in the stack.
 *
 * The stack sits against the bottom of its surface. A rider toggling a chart on expects the room
 * for it to be made above the charts they are already reading, not underneath them — and since
 * the surface itself never resizes, a chart below the newcomer keeps the same coordinates on both
 * sides of the change, so it cannot move even for the frame the canvas takes to repaint.
 */
export function computeChartLayout({
  heights,
  width,
  surfaceHeight = 0,
}: ChartLayoutInput): ChartLayout {
  const plotX = AXIS_WIDTH
  const plotWidth = Math.max(0, width - AXIS_WIDTH * 2)
  const plots: ChartPlotBox[] = []
  const labelBaselines: number[] = []
  const stackHeight =
    heights.length === 0
      ? 0
      : heights.reduce((total, h) => total + h + LABEL_HEIGHT + CHART_GAP, -CHART_GAP)
  let y = Math.max(0, surfaceHeight - (stackHeight + TIME_AXIS_HEIGHT))

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
    canvasHeight: stackHeight + TIME_AXIS_HEIGHT,
    surfaceHeight: Math.max(surfaceHeight, stackHeight + TIME_AXIS_HEIGHT),
    timeAxisBaseline: y + AXIS_FONT_SIZE + 2,
  }
}
