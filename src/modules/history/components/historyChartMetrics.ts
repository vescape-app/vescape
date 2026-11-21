import {
  lengthFromMeters,
  lengthUnit,
  speedFromKmh,
  speedUnit,
  type DistanceUnit,
} from '@/helpers/units'
import type { AutoRangeOptions } from '@/components/charts/chartMath'
import { theme, type ThemeColor } from '@/constants/theme'
import { telemetry, type TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'

const PADDING_RATIO = 0.1

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
    baseline: fixed ? metric.chartRange : undefined,
  }
}

export type OptionalChartMetric =
  'duty' | 'battery' | 'tempMotor' | 'tempController' | 'motorCurrent' | 'batteryCurrent'

export interface ChartMetricDef {
  key: HistoryMetricKey
  label: string
  color: ThemeColor
  range: AutoRangeOptions
  statKeys?: string | string[]
}

export interface OptionalChartMetricDef extends ChartMetricDef {
  key: OptionalChartMetric
  multilineLabel?: [string, string]
  tabLabel?: string
  unit: string
  decimals: number
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
    tabLabel: 'DC',
    color: telemetry.duty.color,
    range: rangeOf(telemetry.duty, { includeZero: true, fixed: true }),
    statKeys: 'max_duty',
    unit: telemetry.duty.unit,
    decimals: telemetry.duty.decimals,
  },
  {
    key: 'battery',
    label: 'Battery',
    color: telemetry.battVoltage.color,
    range: rangeOf(telemetry.battVoltage),
    unit: telemetry.battVoltage.unit,
    decimals: telemetry.battVoltage.decimals,
  },
  {
    key: 'tempMotor',
    label: telemetry.motorTemp.label,
    tabLabel: 'Motor C°',
    color: telemetry.motorTemp.color,
    range: rangeOf(telemetry.motorTemp),
    unit: telemetry.motorTemp.unit,
    decimals: telemetry.motorTemp.decimals,
  },
  {
    key: 'tempController',
    label: telemetry.controllerTemp.label,
    tabLabel: 'Ctrl C°',
    color: telemetry.controllerTemp.color,
    range: rangeOf(telemetry.controllerTemp),
    unit: telemetry.controllerTemp.unit,
    decimals: telemetry.controllerTemp.decimals,
  },
  {
    key: 'motorCurrent',
    label: telemetry.motorCurrent.label,
    multilineLabel: ['Motor', 'Current'],
    color: telemetry.motorCurrent.color,
    range: rangeOf(telemetry.motorCurrent, { includeZero: true }),
    unit: telemetry.motorCurrent.unit,
    decimals: telemetry.motorCurrent.decimals,
  },
  {
    key: 'batteryCurrent',
    label: telemetry.battCurrent.label,
    multilineLabel: ['Batt', 'Current'],
    color: telemetry.battCurrent.color,
    range: rangeOf(telemetry.battCurrent, { includeZero: true }),
    unit: telemetry.battCurrent.unit,
    decimals: telemetry.battCurrent.decimals,
  },
]

export const HISTORY_CHART_DEFS: readonly ChartMetricDef[] = [
  SPEED_CHART_DEF,
  ...OPTIONAL_CHART_METRICS,
]

export type ExtraChartMetric =
  'pitch' | 'roll' | 'balancePitch' | 'footpadAdc1' | 'footpadAdc2' | 'altitude' | 'gpsAccuracy'

export type ExtraChartSource = 'board' | 'gps'

export interface ExtraChartMetricDef {
  key: ExtraChartMetric
  label: string
  multilineLabel?: [string, string]
  color: ThemeColor
  range: AutoRangeOptions
  source: ExtraChartSource
  unit?: string
  decimals?: number
}

function gpsRange(min: number, max: number, minSpan: number, fixed = false): AutoRangeOptions {
  return {
    minSpan,
    paddingRatio: PADDING_RATIO,
    snap: true,
    fallbackMin: min,
    fallbackMax: max,
    baseline: fixed ? { min, max } : undefined,
  }
}

export const EXTRA_CHART_METRICS: readonly ExtraChartMetricDef[] = [
  {
    key: 'pitch',
    label: telemetry.pitch.label,
    color: telemetry.pitch.color,
    range: rangeOf(telemetry.pitch),
    source: 'board',
    unit: telemetry.pitch.unit,
    decimals: telemetry.pitch.decimals,
  },
  {
    key: 'roll',
    label: telemetry.roll.label,
    color: telemetry.roll.color,
    range: rangeOf(telemetry.roll),
    source: 'board',
    unit: telemetry.roll.unit,
    decimals: telemetry.roll.decimals,
  },
  {
    key: 'balancePitch',
    label: telemetry.balancePitch.label,
    multilineLabel: ['Balance', 'Pitch'],
    color: telemetry.balancePitch.color,
    range: rangeOf(telemetry.balancePitch),
    source: 'board',
    unit: telemetry.balancePitch.unit,
    decimals: telemetry.balancePitch.decimals,
  },
  {
    key: 'footpadAdc1',
    label: telemetry.footpadAdc1.label,
    multilineLabel: ['Footpad', 'ADC 1'],
    color: telemetry.footpadAdc1.color,
    range: rangeOf(telemetry.footpadAdc1, { includeZero: true, fixed: true }),
    source: 'board',
    unit: telemetry.footpadAdc1.unit,
    decimals: telemetry.footpadAdc1.decimals,
  },
  {
    key: 'footpadAdc2',
    label: telemetry.footpadAdc2.label,
    multilineLabel: ['Footpad', 'ADC 2'],
    color: telemetry.footpadAdc2.color,
    range: rangeOf(telemetry.footpadAdc2, { includeZero: true, fixed: true }),
    source: 'board',
    unit: telemetry.footpadAdc2.unit,
    decimals: telemetry.footpadAdc2.decimals,
  },
  {
    key: 'altitude',
    label: 'Altitude',
    color: theme.telemetry.altitude,
    range: gpsRange(0, 100, 20),
    source: 'gps',
    unit: 'm',
    decimals: 0,
  },
  {
    key: 'gpsAccuracy',
    label: 'GPS Accuracy',
    multilineLabel: ['GPS', 'Accuracy'],
    color: theme.telemetry.gpsAccuracy,
    range: gpsRange(0, 20, 10),
    source: 'gps',
    unit: 'm',
    decimals: 0,
  },
]

export type ChartToggleMetric = 'speed' | OptionalChartMetric | ExtraChartMetric

export interface ChartTabMetricDef {
  key: ChartToggleMetric
  label: string
  color: ThemeColor
  multilineLabel?: [string, string]
  tabLabel?: string
}

const SPEED_TAB: ChartTabMetricDef = {
  key: SPEED_CHART_DEF.key,
  label: SPEED_CHART_DEF.label,
  color: SPEED_CHART_DEF.color,
}

export const PANEL_CHART_METRICS: readonly ChartTabMetricDef[] = [
  SPEED_TAB,
  ...OPTIONAL_CHART_METRICS.filter(
    (metric) => metric.key !== 'motorCurrent' && metric.key !== 'batteryCurrent',
  ),
]

export const ALL_CHART_METRICS: readonly ChartTabMetricDef[] = [
  SPEED_TAB,
  ...OPTIONAL_CHART_METRICS,
  ...EXTRA_CHART_METRICS,
]

const HISTORY_METRIC_KEYS = new Set<string>(HISTORY_CHART_DEFS.map((def) => def.key))

export function isHistoryMetricKey(key: string): key is HistoryMetricKey {
  return HISTORY_METRIC_KEYS.has(key)
}

export function topActiveChartMetric(
  activeMetrics: ReadonlySet<ChartToggleMetric>,
): ChartToggleMetric | null {
  return ALL_CHART_METRICS.find((def) => activeMetrics.has(def.key))?.key ?? null
}

export function toggleOptionalChartMetric<T extends ChartToggleMetric>(
  activeMetrics: ReadonlySet<T>,
  metric: T,
): Set<T> {
  const next = new Set(activeMetrics)
  if (next.has(metric)) {
    next.delete(metric)
  } else {
    next.add(metric)
  }
  return next
}

export function historyChartPresentation(
  key: ChartToggleMetric,
  distanceUnit: DistanceUnit,
): {
  unit: string | undefined
  displayScale: number
} {
  if (key === 'speed')
    return { unit: speedUnit(distanceUnit), displayScale: speedFromKmh(1, distanceUnit) }
  if (key === 'altitude' || key === 'gpsAccuracy') {
    return { unit: lengthUnit(distanceUnit), displayScale: lengthFromMeters(1, distanceUnit) }
  }
  const definition = [...OPTIONAL_CHART_METRICS, ...EXTRA_CHART_METRICS].find(
    (def) => def.key === key,
  )
  return { unit: definition?.unit, displayScale: 1 }
}
