import { theme } from '@/constants/theme'

/**
 * Telemetry warning thresholds shared across the app — single source of truth
 * for what counts as warning/critical for battery SoC, temperature, speed and
 * duty cycle.
 *
 * Colors come from {@link theme.status} so they stay aligned with the rest of
 * the app's semantic palette. Tune thresholds and colors here, never in
 * components. Add new metrics here when they need an alert level.
 *
 * Consumers today: roster stat visibility, the live battery gauge hint, and the
 * per-metric alert seed values (see {@link DEFAULT_ALERT_SEEDS}).
 */
export const TELEMETRY_THRESHOLDS = {
  /** Battery SoC as a 0-1 fraction. */
  battery: {
    /** Below this fraction: warning (orange). */
    warning: 0.3,
    /** Below this fraction: critical (red). */
    critical: 0.1,
  },
  /** Temperature in °C. */
  temp: {
    /** Above this value: warning (orange). */
    warning: 70,
    /** Above this value: critical (red). */
    critical: 80,
  },
  /** Speed in km/h (absolute). */
  speed: {
    /** Above this value: warning (orange). */
    warning: 35,
    /** Above this value: critical (red). */
    critical: 45,
  },
  /** Duty cycle in %. */
  duty: {
    /** Above this value: warning (orange). */
    warning: 80,
    /** Above this value: critical (red). */
    critical: 90,
  },
} as const

export type TelemetryLevel = 'normal' | 'warning' | 'critical'

/** Color for a telemetry level — palette-sourced, single source of truth. */
export const TELEMETRY_LEVEL_COLOR: Record<TelemetryLevel, string> = {
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

/** Battery SoC level (soc is a 0-1 fraction, null/undefined → normal). */
export function batteryLevel(soc: number | null | undefined): TelemetryLevel {
  return tierLevel(soc, TELEMETRY_THRESHOLDS.battery, 'low')
}

/** Temperature level in °C (null/undefined → normal). */
export function tempLevel(tempC: number | null | undefined): TelemetryLevel {
  return tierLevel(tempC, TELEMETRY_THRESHOLDS.temp, 'high')
}

/** Speed level in km/h, absolute (null/undefined → normal). */
export function speedLevel(kmh: number | null | undefined): TelemetryLevel {
  return tierLevel(Math.abs(kmh ?? 0), TELEMETRY_THRESHOLDS.speed, 'high')
}

/** Duty cycle level in % (null/undefined → normal). */
export function dutyLevel(percent: number | null | undefined): TelemetryLevel {
  return tierLevel(Math.abs(percent ?? 0), TELEMETRY_THRESHOLDS.duty, 'high')
}

/**
 * Alert UI tab the per-control alert editor opens in. Mirrors the local tab
 * state kept by the editor; kept here so {@link DEFAULT_ALERT_SEEDS} can be
 * the single source of truth for the seed values without circular imports.
 */
export type TelemetryAlertTab = 'single' | 'geiger' | 'message'

export interface TelemetryAlertPreset {
  tab: TelemetryAlertTab
  threshold: number
  thresholdMax?: number
}

/**
 * Default alert seeds per alert-enabled control — preselects tab + thresholds
 * when adding a new alert. Thresholds for temp/battery/speed/duty are sourced
 * from {@link TELEMETRY_THRESHOLDS} so the alert defaults track any future
 * tuning of the visual tiers; add new entries here when an alertable metric
 * needs a sensible seed.
 *
 * Battery threshold is expressed in percent for the alert dial, while the
 * underlying tier uses a 0-1 fraction (see {@link TELEMETRY_THRESHOLDS.battery}).
 */
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
