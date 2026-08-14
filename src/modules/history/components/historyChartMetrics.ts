import type { AutoRangeOptions } from '@/components/charts/chartMath'
import { theme } from '@/constants/theme'
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
  /** Short form for a metric tab, where the chart's own label would wrap. */
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

/**
 * Metrics the ride records but the map cannot be coloured by.
 *
 * Kept apart from {@link OPTIONAL_CHART_METRICS} because a {@link HistoryMetricKey} is a promise
 * that the route can be painted with it — attitude, footpad voltage and the GPS fix have no such
 * meaning on a line drawn over a map. They are chart-only, and only the full-screen charts page
 * offers them; the map panel would not have the room.
 */
export type ExtraChartMetric =
  | 'pitch'
  | 'roll'
  | 'balancePitch'
  | 'footpadAdc1'
  | 'footpadAdc2'
  | 'altitude'
  | 'gpsAccuracy'

/** Whether a chart-only metric reads the board stream or the phone's own GPS log. */
export type ExtraChartSource = 'board' | 'gps'

export interface ExtraChartMetricDef {
  key: ExtraChartMetric
  label: string
  multilineLabel?: [string, string]
  color: string
  range: AutoRangeOptions
  source: ExtraChartSource
  unit?: string
  decimals?: number
}

/** The GPS metrics have no board-side definition, so they state their own scale here. */
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
    // Fixed to the sensor's own 0-3.3 V scale: a pad that reads low is only readable against the
    // voltage it should have been, and auto-ranging would hide exactly that.
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

/**
 * Anything a metric tab can switch on: a map-colourable metric, or a chart-only one.
 *
 * Speed is in here even though the ride panel always draws it — on a page that is only charts,
 * the rider is entitled to close it like any other line.
 */
export type ChartToggleMetric = 'speed' | OptionalChartMetric | ExtraChartMetric

/** What a metric tab renders, whichever kind of metric it switches on. */
export interface ChartTabMetricDef {
  key: ChartToggleMetric
  label: string
  color: string
  multilineLabel?: [string, string]
  tabLabel?: string
}

/** The speed chart as a tab, for the surfaces that let the rider close it. */
const SPEED_TAB: ChartTabMetricDef = {
  key: SPEED_CHART_DEF.key,
  label: SPEED_CHART_DEF.label,
  color: SPEED_CHART_DEF.color,
}

/**
 * What the ride panel offers under the map.
 *
 * Deliberately shorter than the full list: the panel is a strip over a map, and the metrics left
 * out of it are a tap away on the full-screen charts page, which has the room to read them.
 */
export const PANEL_CHART_METRICS: readonly ChartTabMetricDef[] = [
  SPEED_TAB,
  ...OPTIONAL_CHART_METRICS.filter(
    (metric) => metric.key !== 'motorCurrent' && metric.key !== 'batteryCurrent',
  ),
]

/** Every metric a full-screen stack can show, speed first and map-colourable ones ahead of the rest. */
export const ALL_CHART_METRICS: readonly ChartTabMetricDef[] = [
  SPEED_TAB,
  ...OPTIONAL_CHART_METRICS,
  ...EXTRA_CHART_METRICS,
]

const HISTORY_METRIC_KEYS = new Set<string>(HISTORY_CHART_DEFS.map((def) => def.key))

/** Whether a chart key names a metric — the stack keys its charts by one. */
export function isHistoryMetricKey(key: string): key is HistoryMetricKey {
  return HISTORY_METRIC_KEYS.has(key)
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
