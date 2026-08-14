import type { ScrubTarget } from '@/components/charts/line/ScrubLayer'
import { buildSeriesPaths, type SeriesPaths } from '@/components/charts/line/seriesPaths'
import { toChartMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartSeriesSpec, ChartSpec } from '@/components/charts/line/types'

export interface PreparedSeries extends ChartSeriesSpec {
  paths: SeriesPaths
}

export interface PreparedChart extends ChartSpec {
  series: PreparedSeries[]
}

export interface PreparedStack {
  charts: PreparedChart[]
  startMs: number
  endMs: number
  isEmpty: boolean
}

const PREPARED_RIDE_CACHE_SIZE = 3
const preparedRideCache = new Map<
  string,
  Map<string, { fingerprint: string; paths: SeriesPaths }>
>()

function seriesFingerprint(series: ChartSeriesSpec): string {
  const { ts, vs } = series.data
  const last = ts.length - 1
  return `${ts.length}:${ts[0] ?? ''}:${ts[last] ?? ''}:${vs[0] ?? ''}:${vs[last] ?? ''}`
}

function cachedSeriesPaths(dataKey: string, series: ChartSeriesSpec): SeriesPaths {
  if (!dataKey) return buildSeriesPaths(series.data)

  let ride = preparedRideCache.get(dataKey)
  if (!ride) {
    ride = new Map()
    preparedRideCache.set(dataKey, ride)
    if (preparedRideCache.size > PREPARED_RIDE_CACHE_SIZE) {
      const oldest = preparedRideCache.keys().next().value
      if (oldest != null) preparedRideCache.delete(oldest)
    }
  } else {
    // Map insertion order doubles as a tiny LRU for the rides around the current selection.
    preparedRideCache.delete(dataKey)
    preparedRideCache.set(dataKey, ride)
  }

  const fingerprint = seriesFingerprint(series)
  const cached = ride.get(series.key)
  if (cached?.fingerprint === fingerprint) return cached.paths

  const paths = buildSeriesPaths(series.data)
  ride.set(series.key, { fingerprint, paths })
  return paths
}

/**
 * Turn every series into its Skia paths and measure the shared time domain, in one pass.
 *
 * Preparing the data and deciding the viewport have to happen together. Reanimated schedules a
 * derived value to the UI thread as the hook is called, so a camera built before the paths
 * would reach the screen first and project the previous dataset through the new viewport — the
 * old line briefly squashed into a corner.
 *
 * The domain is measured across the whole stack even though each chart now draws itself: charts
 * shown side by side have to share one x scale, or the same moment would sit at two different
 * places depending on which metric the rider looks at.
 */
export function prepareStack(charts: ChartSpec[], dataKey = ''): PreparedStack {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY

  const prepared = charts.map((chart) => ({
    ...chart,
    series: chart.series.map((series) => {
      const paths = cachedSeriesPaths(dataKey, series)
      if (!paths.isEmpty) {
        startMs = Math.min(startMs, paths.domainStartMs)
        endMs = Math.max(endMs, paths.domainEndMs)
      }
      return { ...series, paths }
    }),
  }))

  const hasData = Number.isFinite(startMs) && endMs > startMs
  return {
    charts: prepared,
    startMs: hasData ? startMs : 0,
    endMs: hasData ? endMs : 1,
    isEmpty: !hasData,
  }
}

/** Every series and band of a stack in chart time, so the canvas never sees a cut ride. */
export function compactCharts(charts: ChartSpec[], timeline: ChartTimeline | null): ChartSpec[] {
  if (timeline == null) return charts
  return charts.map((chart) => ({
    ...chart,
    series: chart.series.map((series) => ({
      ...series,
      data: { ts: series.data.ts.map((ms) => toChartMs(ms, timeline)), vs: series.data.vs },
    })),
    bands: compactBands(chart.bands, timeline),
  }))
}

export function compactBands(
  bands: ChartBand[] | undefined,
  timeline: ChartTimeline | null,
): ChartBand[] | undefined {
  if (timeline == null || bands == null) return bands
  return bands.map((band) => ({
    ...band,
    startMs: toChartMs(band.startMs, timeline),
    endMs: toChartMs(band.endMs, timeline),
  }))
}

/** What the scrub readout needs of a chart: a line to sample, and the axis it is read against. */
export function toScrubTargets(chart: PreparedChart): ScrubTarget[] {
  return chart.series.map((series) => ({
    paths: series.paths,
    color: series.color,
    label: series.label,
    unit: series.unit,
    decimals: series.decimals,
    range: (series.axis === 'right' ? chart.right : chart.left)?.range ?? chart.left.range,
  }))
}
