import {
  speedFromKmh,
  speedUnit,
  temperatureDisplayOffset,
  temperatureDisplayScale,
  temperatureSymbol,
  type DistanceUnit,
  type TemperatureUnit,
} from '@/helpers/units'
import { theme, type ThemeColor } from '@/constants/theme'

interface TelemetryChartRange {
  min: number
  max: number
}

export interface TelemetryMetricConfig {
  label: string
  unit: string
  color: ThemeColor
  decimals: number
  chartRange: TelemetryChartRange
  minSpan?: number
  controlId?: string
  format: (value: number) => string
  formatWithUnit: (value: number) => string
}

type TelemetryMetricDefinition = Omit<TelemetryMetricConfig, 'format' | 'formatWithUnit'> & {
  abs?: boolean
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
      return `${num} ${config.unit}`
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
    chartRange: { min: 0, max: 100 },
    minSpan: 5,
    controlId: 'battery',
  },
  batteryPercent: {
    label: 'Battery Charge',
    unit: '%',
    color: theme.telemetry.battVoltage,
    decimals: 0,
    chartRange: { min: 0, max: 100 },
    minSpan: 20,
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
    color: theme.telemetry.footpad1,
    decimals: 3,
    chartRange: { min: 0, max: 3.3 },
    minSpan: 0.5,
  },
  footpadAdc2: {
    label: 'ADC 2',
    unit: 'V',
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

/**
 * @parity /modules/vescape-core/ios/watch/WatchGauge.swift `tempMin`
 * @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TEMP_MIN`
 */
export const RIM_TEMP_RANGE = { min: 20, max: 100 } as const

export const HUD_ARC_EDGE_INSET = 12

export const HUD_IDLE_GLYPH_COLOR = theme.alpha(theme.palette.slate.textDim, 0.4)

export const telemetryByControlId = Object.fromEntries(
  Object.values(telemetry)
    .filter((metric) => metric.controlId != null)
    .map((metric) => [metric.controlId, metric]),
) as Record<string, TelemetryMetricConfig>

export function presentTelemetryMetric(
  metric: TelemetryMetricConfig,
  distanceUnit: DistanceUnit,
  temperatureUnit: TemperatureUnit = 'celsius',
) {
  if (metric.unit === 'km/h') {
    const displayScale = speedFromKmh(1, distanceUnit)
    const unit = speedUnit(distanceUnit)
    const format = (value: number) => metric.format(value * displayScale)
    return {
      ...metric,
      unit,
      displayScale,
      displayOffset: 0,
      format,
      formatWithUnit: (value: number) => `${format(value)} ${unit}`,
    }
  }
  if (metric.unit === '°C') {
    const displayScale = temperatureDisplayScale(temperatureUnit)
    const displayOffset = temperatureDisplayOffset(temperatureUnit)
    const unit = temperatureSymbol(temperatureUnit)
    const format = (value: number) => metric.format(value * displayScale + displayOffset)
    return {
      ...metric,
      unit,
      displayScale,
      displayOffset,
      format,
      formatWithUnit: (value: number) => `${format(value)} ${unit}`,
    }
  }
  return { ...metric, displayScale: 1, displayOffset: 0 }
}
