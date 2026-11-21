import { theme, type ThemeColor } from '@/constants/theme'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryThresholds.kt `TelemetryThresholds`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryThresholds.swift `TelemetryThresholds`
 */
export const TELEMETRY_THRESHOLDS = {
  battery: {
    warning: 0.3,
    critical: 0.1,
  },
  temp: {
    warning: 70,
    critical: 80,
  },
  speed: {
    warning: 35,
    critical: 45,
  },
  duty: {
    warning: 80,
    critical: 90,
  },
} as const

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryLevel.kt `TelemetryLevel`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryLevel.swift `TelemetryLevel`
 */
export type TelemetryLevel = 'normal' | 'warning' | 'critical'

export const TELEMETRY_LEVEL_COLOR: Record<TelemetryLevel, ThemeColor> = {
  normal: theme.palette.slate.textSecondary,
  warning: theme.status.warning.color,
  critical: theme.status.error.color,
}

interface TieredThreshold {
  warning: number
  critical: number
}

function tierLevel(
  value: number | null | undefined,
  spec: TieredThreshold,
  direction: 'low' | 'high',
): TelemetryLevel {
  if (value == null) return 'normal'
  if (direction === 'low') {
    if (value < spec.critical) return 'critical'
    if (value < spec.warning) return 'warning'
  } else {
    if (value > spec.critical) return 'critical'
    if (value > spec.warning) return 'warning'
  }
  return 'normal'
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryThresholds.kt `batteryLevel`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryThresholds.swift `batteryLevel`
 */
export function batteryLevel(soc: number | null | undefined): TelemetryLevel {
  return tierLevel(soc, TELEMETRY_THRESHOLDS.battery, 'low')
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryThresholds.kt `tempLevel`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryThresholds.swift `tempLevel`
 */
export function tempLevel(tempC: number | null | undefined): TelemetryLevel {
  return tierLevel(tempC, TELEMETRY_THRESHOLDS.temp, 'high')
}

export function speedLevel(kmh: number | null | undefined): TelemetryLevel {
  return tierLevel(Math.abs(kmh ?? 0), TELEMETRY_THRESHOLDS.speed, 'high')
}

export function dutyLevel(percent: number | null | undefined): TelemetryLevel {
  return tierLevel(Math.abs(percent ?? 0), TELEMETRY_THRESHOLDS.duty, 'high')
}

export type TelemetryAlertTab = 'single' | 'geiger' | 'message'

export interface TelemetryAlertPreset {
  tab: TelemetryAlertTab
  threshold: number
  thresholdMax?: number
}

export const DEFAULT_ALERT_SEEDS: Record<string, TelemetryAlertPreset> = {
  'motor-temp': { tab: 'message', threshold: TELEMETRY_THRESHOLDS.temp.warning },
  battery: { tab: 'message', threshold: TELEMETRY_THRESHOLDS.battery.warning * 100 },
  speed: {
    tab: 'geiger',
    threshold: TELEMETRY_THRESHOLDS.speed.warning,
    thresholdMax: TELEMETRY_THRESHOLDS.speed.critical,
  },
  duty: {
    tab: 'geiger',
    threshold: TELEMETRY_THRESHOLDS.duty.warning,
    thresholdMax: TELEMETRY_THRESHOLDS.duty.critical,
  },
}
