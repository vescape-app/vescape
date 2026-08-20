import type { ExcludedRange } from '@/components/charts/chartMath'
import type {
  ChartBand,
  ChartSeriesData,
  ChartSpec,
  ChartYRange,
} from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import type { LiveMetricPoint } from '@/modules/board/hooks/useLiveMetric'

/**
 * Live samples as the parallel arrays a chart draws from, cut to the rider's live window.
 *
 * The window is applied here rather than by the camera: it is the domain a live stack shows, and
 * the stack measures its own domain from the data it is handed. Zooming in is still the camera's
 * job — this only decides how much ride is on the table.
 */
export function toChartSeries(
  samples: readonly LiveMetricPoint[],
  windowMs?: number,
): ChartSeriesData {
  const cutoff = windowMs ? (samples.at(-1)?.ts ?? 0) - windowMs : Number.NEGATIVE_INFINITY
  const ts: number[] = []
  const vs: number[] = []
  for (const sample of samples) {
    if (sample.ts < cutoff) continue
    ts.push(sample.ts)
    vs.push(sample.value)
  }
  return { ts, vs }
}

function exclusionColor(reason: string): string {
  return reason === 'free_spin' ? theme.palette.yellow.color : theme.palette.slate.textSecondary
}

/** Excluded stretches as hairlines on the floor of the plot, clear of the line they annotate. */
export function toChartBands(ranges: ExcludedRange[] | undefined): ChartBand[] | undefined {
  if (!ranges || ranges.length === 0) return undefined
  return ranges.map((range) => ({
    startMs: range.startMs,
    endMs: range.endMs,
    color: exclusionColor(range.reason),
    row: 0,
    fill: 'floor' as const,
  }))
}

/** A live chart plus the alert control it belongs to, if any. */
export interface LiveChartSpec extends ChartSpec {
  /** Alert system controlId — the chart of the layout's own control gets its threshold lines. */
  controlId?: string
}

export interface LiveChartInput {
  key: string
  metric: TelemetryMetricConfig
  label?: string
  data: ChartSeriesData
  range: ChartYRange
  height?: number
  bands?: ChartBand[]
  /** Horizontal reference lines on the left axis — where a configured threshold sits. */
  thresholds?: number[]
  /** A second line on the right-hand axis — pack voltage under pack percent. */
  secondary?: {
    key: string
    data: ChartSeriesData
    range: ChartYRange
    color: string
    label?: string
    unit?: string
    decimals?: number
  }
}

const DEFAULT_CHART_HEIGHT = 80

/** One detail chart of a live stack, described in the terms a metric config already carries. */
export function toLiveChart({
  key,
  metric,
  label,
  data,
  range,
  height = DEFAULT_CHART_HEIGHT,
  bands,
  thresholds,
  secondary,
}: LiveChartInput): LiveChartSpec {
  return {
    key,
    label: label ?? metric.label,
    height,
    controlId: metric.controlId,
    left: { range },
    right: secondary ? { range: secondary.range } : undefined,
    bands,
    thresholds,
    series: [
      {
        key,
        data,
        color: metric.color,
        label: label ?? metric.label,
        unit: metric.unit,
        decimals: metric.decimals,
      },
      ...(secondary
        ? [
            {
              key: secondary.key,
              data: secondary.data,
              color: secondary.color,
              axis: 'right' as const,
              label: secondary.label,
              unit: secondary.unit,
              decimals: secondary.decimals,
            },
          ]
        : []),
    ],
  }
}
