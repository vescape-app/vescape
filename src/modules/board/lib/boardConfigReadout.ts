import type { BoardConfigFieldId } from 'vescape-core'

export type BoardConfigValue = number | boolean | undefined

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt
 * @parity /modules/vescape-core/ios/config/McconfLayouts.swift
 */
export type MotorConfigFieldId =
  | 'l_abs_current_max'
  | 'l_battery_cut_end'
  | 'l_battery_cut_start'
  | 'l_current_max'
  | 'l_current_min'
  | 'l_in_current_max'
  | 'l_in_current_min'
  | 'l_max_duty'
  | 'l_max_erpm'
  | 'l_max_vin'
  | 'l_min_erpm'
  | 'l_min_vin'
  | 'l_temp_fet_end'
  | 'l_temp_fet_start'
  | 'l_temp_motor_end'
  | 'l_temp_motor_start'

export interface ConfigRow<Id extends string> {
  id: Id
  label: string
  format: (value: BoardConfigValue) => string
  description?: string
  when?: string
  recommended?: 'on' | 'off'
  note?: (value: BoardConfigValue) => string | null
}

export type BoardConfigRow = ConfigRow<BoardConfigFieldId>
export type MotorConfigRow = ConfigRow<MotorConfigFieldId>

const MISSING = '—'

export function volts(value: BoardConfigValue, zeroLabel?: string): string {
  if (typeof value !== 'number') return MISSING
  if (value === 0 && zeroLabel) return zeroLabel
  return `${value.toFixed(2)} V`
}

export function millis(value: BoardConfigValue): string {
  if (typeof value !== 'number') return MISSING
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

export function erpm(value: BoardConfigValue): string {
  return typeof value === 'number' ? `${Math.round(value)} ERPM` : MISSING
}

export function unit(suffix: string, decimals = 1): (value: BoardConfigValue) => string {
  const separator = suffix.startsWith('°') && suffix.length === 1 ? '' : ' '
  return (value) =>
    typeof value === 'number' ? `${value.toFixed(decimals)}${separator}${suffix}` : MISSING
}

export function percent(value: BoardConfigValue): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : MISSING
}

export function isEnabled(value: BoardConfigValue): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return null
}

export function onOff(value: BoardConfigValue): string {
  const enabled = isEnabled(value)
  return enabled == null ? MISSING : enabled ? 'On' : 'Off'
}
