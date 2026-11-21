import { speedFromKmh, speedUnit, type DistanceUnit } from '@/helpers/units'
import type { ExcludedRange } from '@/components/charts/chartMath'
import type {
  ChartBand,
  ChartSeriesData,
  ChartSpec,
  ChartYRange,
} from '@/components/charts/line/types'
import { theme, type ThemeColor } from '@/constants/theme'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import type { LiveMetricPoint } from '@/modules/board/hooks/useLiveMetric'

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

function exclusionColor(reason: string): ThemeColor {
  return reason === 'free_spin' ? theme.palette.yellow.color : theme.palette.slate.textSecondary
}

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

export interface LiveChartSpec extends ChartSpec {
  controlId?: string
}

export interface LiveChartInput {
  key: string
  metric: TelemetryMetricConfig
  data: ChartSeriesData
  range: ChartYRange
  height?: number
  bands?: ChartBand[]
  thresholds?: number[]
  secondary?: {
    key: string
    data: ChartSeriesData
    range: ChartYRange
    color: ThemeColor
    unit?: string
    decimals?: number
  }
}

const DEFAULT_CHART_HEIGHT = 80

export function toLiveChart({
  key,
  metric,
  data,
  range,
  height = DEFAULT_CHART_HEIGHT,
  bands,
  thresholds,
  secondary,
}: LiveChartInput): LiveChartSpec {
  return {
    key,
    label: metric.label,
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
              unit: secondary.unit,
              decimals: secondary.decimals,
            },
          ]
        : []),
    ],
  }
}

export function presentLiveChart(chart: ChartSpec, distanceUnit: DistanceUnit): ChartSpec {
  const speed = chart.series.some((series) => series.unit === 'km/h' && series.axis !== 'right')
  const rightSpeed = chart.series.some(
    (series) => series.unit === 'km/h' && series.axis === 'right',
  )
  const scale = speedFromKmh(1, distanceUnit)
  return {
    ...chart,
    left: speed ? { ...chart.left, displayScale: scale } : chart.left,
    right: rightSpeed && chart.right ? { ...chart.right, displayScale: scale } : chart.right,
    series: chart.series.map((series) =>
      series.unit === 'km/h'
        ? { ...series, displayScale: scale, unit: speedUnit(distanceUnit) }
        : series,
    ),
  }
}
