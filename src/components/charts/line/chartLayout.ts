import type { ChartPlotBand, ChartPlotBox } from '@/components/charts/line/types'

export const AXIS_WIDTH = 34
export const AXIS_FONT_SIZE = 8
export const LABEL_FONT_SIZE = 10
export const LABEL_HEIGHT = 14
export const PLOT_TOP_PAD = 8
export const TIME_AXIS_HEIGHT = 12
export const CHART_GAP = 8
export const TIME_AXIS_BASELINE = AXIS_FONT_SIZE + 2

export function plotWidthFor(width: number): number {
  return Math.max(0, width - AXIS_WIDTH * 2)
}

export function stackChromeHeight(chartCount: number): number {
  return chartCount * (LABEL_HEIGHT + CHART_GAP) + TIME_AXIS_HEIGHT
}

export interface ChartRowInput {
  width: number
  height: number
  hasLabel?: boolean
}

export interface ChartRowLayout {
  plot: ChartPlotBox
  labelBaseline: number
  canvasHeight: number
}

export function computeChartRow({ width, height, hasLabel = true }: ChartRowInput): ChartRowLayout {
  const strip = hasLabel ? LABEL_HEIGHT : PLOT_TOP_PAD
  return {
    labelBaseline: strip - 4,
    plot: { x: AXIS_WIDTH, y: strip, width: plotWidthFor(width), height },
    canvasHeight: strip + height,
  }
}

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
