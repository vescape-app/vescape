import type { AutoRangeOptions } from '@/components/charts/chartMath'
import { telemetry, type TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'

/** Breathing room above and below the ride's own extremes, as a fraction of the span. */
const PADDING_RATIO = 0.1

/**
 * The y domain of a metric's chart, taken from the metric's own definition.
 *
 * `minSpan` is what keeps a flat ride from being drawn as a mountain range: without it a motor
 * temperature that never moved more than a degree fills the plot with sensor noise. It and the
 * fallback bounds belong to the metric, not to this chart — {@link telemetry} already states both,
 * so read them from there rather than restating them per chart.
 */
function rangeOf(
  metric: TelemetryMetricConfig,
  { includeZero = false, fixed = false } = {},
): AutoRangeOptions {
  return {
    includeZero,
    minSpan: metric.minSpan ?? metric.chartRange.max - metric.chartRange.min,
    paddingRatio: PADDING_RATIO,
    snap: true,
    fallbackMin: metric.chartRange.min,
    fallbackMax: metric.chartRange.max,
    // Metrics read against a scale the rider already knows keep it, and only stretch past it when
    // the ride actually did. The rest have no meaningful fixed scale — a ±300 A axis would hide
    // every current a ride ever draws.
    baseline: fixed ? metric.chartRange : undefined,
  }
}

export type OptionalChartMetric =
  | 'duty'
  | 'battery'
  | 'tempMotor'
  | 'tempController'
  | 'motorCurrent'
  | 'batteryCurrent'

export interface ChartMetricDef {
  key: HistoryMetricKey
  label: string
  color: string
  range: AutoRangeOptions
  /** Session-exclusion stat keys that grey out this chart's ranges. */
  statKeys?: string | string[]
}

export interface OptionalChartMetricDef extends ChartMetricDef {
  key: OptionalChartMetric
  multilineLabel?: [string, string]
}

export const SPEED_CHART_DEF: ChartMetricDef = {
  key: 'speed',
  label: telemetry.speed.label,
  color: telemetry.speed.color,
  range: rangeOf(telemetry.speed, { includeZero: true, fixed: true }),
  statKeys: ['avg_speed', 'max_speed'],
}

export const OPTIONAL_CHART_METRICS: readonly OptionalChartMetricDef[] = [
  {
    key: 'duty',
    label: telemetry.duty.label,
    multilineLabel: ['Duty', 'Cycle'],
    color: telemetry.duty.color,
    range: rangeOf(telemetry.duty, { includeZero: true, fixed: true }),
    statKeys: 'max_duty',
  },
  {
    key: 'battery',
    label: 'Battery',
    color: telemetry.battVoltage.color,
    range: rangeOf(telemetry.battVoltage),
  },
  {
    key: 'tempMotor',
    label: telemetry.motorTemp.label,
    multilineLabel: ['Motor', 'Temp'],
    color: telemetry.motorTemp.color,
    range: rangeOf(telemetry.motorTemp),
  },
  {
    key: 'tempController',
    label: telemetry.controllerTemp.label,
    multilineLabel: ['Controller', 'Temp'],
    color: telemetry.controllerTemp.color,
    range: rangeOf(telemetry.controllerTemp),
  },
  {
    key: 'motorCurrent',
    label: telemetry.motorCurrent.label,
    multilineLabel: ['Motor', 'Current'],
    color: telemetry.motorCurrent.color,
    range: rangeOf(telemetry.motorCurrent, { includeZero: true }),
  },
  {
    key: 'batteryCurrent',
    label: telemetry.battCurrent.label,
    multilineLabel: ['Batt', 'Current'],
    color: telemetry.battCurrent.color,
    range: rangeOf(telemetry.battCurrent, { includeZero: true }),
  },
]

export const HISTORY_CHART_DEFS: readonly ChartMetricDef[] = [
  SPEED_CHART_DEF,
  ...OPTIONAL_CHART_METRICS,
]

const HISTORY_METRIC_KEYS = new Set<string>(HISTORY_CHART_DEFS.map((def) => def.key))

/** Whether a chart key names a metric — the stack keys its charts by one. */
export function isHistoryMetricKey(key: string): key is HistoryMetricKey {
  return HISTORY_METRIC_KEYS.has(key)
}

export function toggleOptionalChartMetric(
  activeMetrics: ReadonlySet<OptionalChartMetric>,
  metric: OptionalChartMetric,
): Set<OptionalChartMetric> {
  const next = new Set(activeMetrics)
  if (next.has(metric)) {
    next.delete(metric)
  } else {
    next.add(metric)
  }
  return next
}
