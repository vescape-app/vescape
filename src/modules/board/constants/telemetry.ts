import { theme } from '@/constants/theme'
type TelemetryChartRange = { min: number; max: number }

export interface TelemetryMetricConfig {
  label: string
  unit: string
  color: string
  decimals: number
  chartRange: TelemetryChartRange
  /**
   * Smallest y span an auto-ranged chart of this metric may show.
   *
   * Without it a metric that barely moved is drawn as if it did: a pack that sagged half a volt
   * fills the plot with what is really sensor noise. Omit for fixed-range metrics.
   */
  minSpan?: number
  /** Alert system controlId (kebab-case). Omit if metric has no alert support. */
  controlId?: string
  /** Format a numeric value (no unit suffix). */
  format: (value: number) => string
  /** Format a numeric value with unit suffix. */
  formatWithUnit: (value: number) => string
}

type TelemetryMetricDefinition = Omit<TelemetryMetricConfig, 'format' | 'formatWithUnit'> & {
  /** Display absolute values for this metric. */
  abs?: boolean
  /** Remove the separator between number and unit in formatWithUnit. */
  compactUnit?: boolean
}

type TelemetryDefinitions = Record<string, TelemetryMetricDefinition>

function defineMetric(config: TelemetryMetricDefinition): TelemetryMetricConfig {
  const abs = config.abs ?? false
  const formatNumber = (value: number) => {
    const val = abs ? Math.abs(value) : value
    return config.decimals === 0 ? Math.round(val).toString() : val.toFixed(config.decimals)
  }

  return {
    label: config.label,
    unit: config.unit,
    color: config.color,
    decimals: config.decimals,
    chartRange: config.chartRange,
    minSpan: config.minSpan,
    controlId: config.controlId,
    format: formatNumber,
    formatWithUnit: (v: number) => {
      const num = formatNumber(v)
      if (!config.unit) return num
      return config.compactUnit ? `${num}${config.unit}` : `${num} ${config.unit}`
    },
  }
}

function defineTelemetry<const T extends TelemetryDefinitions>(
  definitions: T,
): { readonly [K in keyof T]: TelemetryMetricConfig } {
  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [key, defineMetric(definition)]),
  ) as { readonly [K in keyof T]: TelemetryMetricConfig }
}

const telemetryDefinitions = {
  speed: {
    label: 'Speed',
    unit: 'km/h',
    color: theme.telemetry.speed,
    decimals: 0,
    chartRange: { min: 0, max: 50 },
    minSpan: 10,
    controlId: 'speed',
    abs: true,
  },
  duty: {
    label: 'Duty Cycle',
    unit: '%',
    color: theme.telemetry.duty,
    decimals: 0,
    chartRange: { min: 0, max: 100 },
    minSpan: 20,
    controlId: 'duty',
  },
  motorCurrent: {
    label: 'Motor Current',
    unit: 'A',
    color: theme.telemetry.motorCurrent,
    decimals: 0,
    chartRange: { min: -300, max: 300 },
    minSpan: 20,
    controlId: 'motor-current',
  },
  battCurrent: {
    label: 'Batt Current',
    unit: 'A',
    color: theme.telemetry.battCurrent,
    decimals: 0,
    chartRange: { min: -300, max: 300 },
    minSpan: 20,
    controlId: 'batt-current',
  },
  battVoltage: {
    label: 'Battery Voltage',
    unit: 'V',
    color: theme.telemetry.battVoltage,
    decimals: 1,
    compactUnit: true,
    chartRange: { min: 0, max: 100 },
    minSpan: 5,
    controlId: 'battery',
  },
  motorTemp: {
    label: 'Motor Temp',
    unit: '°C',
    color: theme.telemetry.motorTemp,
    decimals: 0,
    chartRange: { min: 0, max: 100 },
    minSpan: 30,
    controlId: 'motor-temp',
  },
  controllerTemp: {
    label: 'Controller Temp',
    unit: '°C',
    color: theme.telemetry.controllerTemp,
    decimals: 0,
    chartRange: { min: 0, max: 100 },
    minSpan: 30,
    controlId: 'controller-temp',
  },
  footpadAdc1: {
    label: 'ADC 1',
    unit: 'V',
    compactUnit: true,
    color: theme.telemetry.footpad1,
    decimals: 3,
    chartRange: { min: 0, max: 3.3 },
    minSpan: 0.5,
  },
  footpadAdc2: {
    label: 'ADC 2',
    unit: 'V',
    compactUnit: true,
    color: theme.telemetry.footpad2,
    decimals: 3,
    chartRange: { min: 0, max: 3.3 },
    minSpan: 0.5,
  },
  pitch: {
    label: 'Pitch',
    unit: '°',
    color: theme.telemetry.pitch,
    decimals: 1,
    chartRange: { min: -15, max: 15 },
    minSpan: 20,
  },
  roll: {
    label: 'Roll',
    unit: '°',
    color: theme.telemetry.roll,
    decimals: 1,
    chartRange: { min: -15, max: 15 },
    minSpan: 20,
  },
  balancePitch: {
    label: 'Balance Pitch',
    unit: '°',
    color: theme.telemetry.balancePitch,
    decimals: 1,
    chartRange: { min: -15, max: 15 },
    minSpan: 20,
  },
} satisfies TelemetryDefinitions

export const telemetry = defineTelemetry(telemetryDefinitions)

export const telemetryByControlId = Object.fromEntries(
  Object.values(telemetry)
    .filter((metric) => metric.controlId != null)
    .map((metric) => [metric.controlId, metric]),
) as Record<string, TelemetryMetricConfig>
