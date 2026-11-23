import { resolveAdaptiveColor, type ResolvedTheme } from '@/constants/theme'
import type { PreparedChart } from '@/components/charts/line/stackData'
import type { SeriesPaths } from '@/components/charts/line/seriesPaths'
import type { ChartYRange } from '@/components/charts/line/types'

export interface ScrubTarget {
  paths: SeriesPaths
  color: string
  label?: string
  unit?: string
  decimals?: number
  displayScale?: number
  displayOffset?: number
  range: ChartYRange
}

export function toScrubTargets(chart: PreparedChart, appearance: ResolvedTheme): ScrubTarget[] {
  return chart.series.map((series) => ({
    paths: series.paths,
    color: resolveAdaptiveColor(series.color, appearance),
    label: series.label,
    unit: series.unit,
    decimals: series.decimals,
    displayScale: series.displayScale,
    displayOffset: series.displayOffset,
    range: (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range,
  }))
}
