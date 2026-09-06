import type { PreparedChart } from '@/components/charts/line/stackData'
import type { SeriesPaths } from '@/components/charts/line/seriesPaths'
import type { ChartYRange } from '@/components/charts/line/types'

export interface ScrubTarget {
  paths: SeriesPaths
  color: string
  label?: string
  unit?: string
  decimals?: number
  range: ChartYRange
}

/** What the scrub readout needs of a chart: a line to sample, and the axis it is read against. */
export function toScrubTargets(
  chart: PreparedChart,
  resolveColor: (color: string) => string = (color) => color,
): ScrubTarget[] {
  return chart.series.map((series) => ({
    paths: series.paths,
    // Chart specs may carry a native adaptive ColorValue. Skia only accepts renderer-safe colors.
    color: resolveColor(series.color),
    label: series.label,
    unit: series.unit,
    decimals: series.decimals,
    range: (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range,
  }))
}
