import type { AutoRangeOptions } from '@/components/charts/chartMath'
import type { ChartNumberFormat } from '@/components/charts/line/chartFormat'
import { telemetry } from '@/modules/board/constants/telemetry'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'

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
  /** How the head reading is printed. Data rather than a formatter: it runs in a worklet. */
  reading: ChartNumberFormat
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
  range: { includeZero: true, minSpan: 10, paddingRatio: 0.1, fallbackMin: -5, fallbackMax: 5 },
  reading: { decimals: 0, unit: telemetry.speed.unit, abs: true },
  statKeys: ['avg_speed', 'max_speed'],
}

export const OPTIONAL_CHART_METRICS: readonly OptionalChartMetricDef[] = [
  {
    key: 'duty',
    label: telemetry.duty.label,
    multilineLabel: ['Duty', 'Cycle'],
    color: telemetry.duty.color,
    range: { includeZero: true, minSpan: 20, paddingRatio: 0.1, fallbackMin: 0, fallbackMax: 100 },
    reading: { decimals: 0, unit: '%', compactUnit: true },
    statKeys: 'max_duty',
  },
  {
    key: 'battery',
    label: 'Battery',
    color: telemetry.battVoltage.color,
    range: { includeZero: false, minSpan: 5, paddingRatio: 0.1, fallbackMin: 30, fallbackMax: 60 },
    reading: { decimals: 1, unit: telemetry.battVoltage.unit, compactUnit: true },
  },
  {
    key: 'tempMotor',
    label: telemetry.motorTemp.label,
    multilineLabel: ['Motor', 'Temp'],
    color: telemetry.motorTemp.color,
    range: { includeZero: false, minSpan: 20, paddingRatio: 0.1, fallbackMin: 0, fallbackMax: 100 },
    reading: { decimals: 0, unit: telemetry.motorTemp.unit },
  },
  {
    key: 'tempController',
    label: telemetry.controllerTemp.label,
    multilineLabel: ['Controller', 'Temp'],
    color: telemetry.controllerTemp.color,
    range: { includeZero: false, minSpan: 20, paddingRatio: 0.1, fallbackMin: 0, fallbackMax: 100 },
    reading: { decimals: 0, unit: telemetry.controllerTemp.unit },
  },
  {
    key: 'motorCurrent',
    label: telemetry.motorCurrent.label,
    multilineLabel: ['Motor', 'Current'],
    color: telemetry.motorCurrent.color,
    range: { includeZero: true, minSpan: 10, paddingRatio: 0.1, fallbackMin: -5, fallbackMax: 5 },
    reading: { decimals: 0, unit: telemetry.motorCurrent.unit },
  },
  {
    key: 'batteryCurrent',
    label: telemetry.battCurrent.label,
    multilineLabel: ['Batt', 'Current'],
    color: telemetry.battCurrent.color,
    range: { includeZero: true, minSpan: 5, paddingRatio: 0.1, fallbackMin: -5, fallbackMax: 5 },
    reading: { decimals: 0, unit: telemetry.battCurrent.unit },
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
