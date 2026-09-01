import { DASH } from '@/helpers/format'
import type { BoardConfigFieldId } from 'vescape-core'

interface AppTuneFieldDefinition {
  /** Refloat schema field id, typed against the named set so a typo cannot reach a slider. */
  id: BoardConfigFieldId
  label: string
  unit: string | null
  min: number
  max: number
}

export interface AppTuneGroupDefinition {
  id: string
  title: string
  fields: AppTuneFieldDefinition[]
}

export const APP_TUNE_GROUPS: AppTuneGroupDefinition[] = [
  {
    id: 'general',
    title: 'General',
    fields: [
      { id: 'kp', label: 'Angle P', unit: null, min: 0, max: 50 },
      { id: 'kp2', label: 'Rate P', unit: null, min: 0, max: 5 },
      { id: 'kp_brake', label: 'Angle P (Braking)', unit: 'x', min: 0, max: 5 },
      { id: 'kp2_brake', label: 'Rate P (Braking)', unit: 'x', min: 0, max: 5 },
      { id: 'ki', label: 'Angle I', unit: null, min: 0, max: 1 },
      { id: 'ki_limit', label: 'I Term Limit', unit: 'A', min: 0, max: 100 },
      { id: 'mahony_kp', label: 'Pitch KP', unit: null, min: 0, max: 10 },
      { id: 'mahony_kp_roll', label: 'Roll KP', unit: null, min: 0, max: 10 },
    ],
  },
  {
    id: 'atr',
    title: 'ATR',
    fields: [
      { id: 'atr_strength_up', label: 'ATR Uphill Strength', unit: null, min: 0, max: 2 },
      { id: 'atr_strength_down', label: 'ATR Downhill Strength', unit: null, min: 0, max: 2 },
      { id: 'atr_threshold_up', label: 'Threshold Angle Up', unit: 'deg', min: 0, max: 20 },
      { id: 'atr_threshold_down', label: 'Threshold Angle Down', unit: 'deg', min: 0, max: 20 },
      { id: 'atr_speed_boost', label: 'Speed Boost', unit: '%', min: 0, max: 100 },
      { id: 'atr_angle_limit', label: 'Tiltback Angle Limit', unit: 'deg', min: 0, max: 20 },
      { id: 'atr_on_speed', label: 'Max Tiltback Speed', unit: 'deg/s', min: 0, max: 200 },
      { id: 'atr_off_speed', label: 'Max Tiltback Release Speed', unit: 'deg/s', min: 0, max: 200 },
      { id: 'atr_response_boost', label: 'Tiltback Response Boost', unit: 'x', min: 0, max: 5 },
      { id: 'atr_transition_boost', label: 'Tiltback Transition Boost', unit: 'x', min: 0, max: 5 },
      { id: 'atr_filter', label: 'Current Filter', unit: 'Hz', min: 0, max: 50 },
      {
        id: 'atr_amps_accel_ratio',
        label: 'Amps to Acceleration Ratio',
        unit: null,
        min: 0,
        max: 20,
      },
      {
        id: 'atr_amps_decel_ratio',
        label: 'Amps to Deceleration Ratio',
        unit: null,
        min: 0,
        max: 20,
      },
    ],
  },
  {
    id: 'turn_tiltback',
    title: 'Turn tiltback',
    fields: [
      { id: 'turntilt_strength', label: 'Strength', unit: null, min: 0, max: 15 },
      { id: 'turntilt_angle_limit', label: 'Tiltback Angle Limit', unit: 'deg', min: 0, max: 20 },
      {
        id: 'turntilt_start_angle',
        label: 'Turn Aggregate Threshold',
        unit: 'deg',
        min: 0,
        max: 90,
      },
      { id: 'turntilt_start_erpm', label: 'ERPM Threshold', unit: 'ERPM', min: 0, max: 30000 },
      { id: 'turntilt_speed', label: 'Max Tiltback Speed', unit: 'deg/s', min: 0, max: 200 },
      { id: 'turntilt_erpm_boost', label: 'Speed Boost %', unit: '%', min: 0, max: 100 },
      {
        id: 'turntilt_erpm_boost_end',
        label: 'Speed Boost Max ERPM',
        unit: 'ERPM',
        min: 0,
        max: 30000,
      },
      {
        id: 'turntilt_yaw_aggregate',
        label: 'Turn Aggregate Target',
        unit: 'deg',
        min: 0,
        max: 180,
      },
    ],
  },
  {
    id: 'torque_tiltback',
    title: 'Torque tiltback',
    fields: [
      { id: 'torquetilt_strength', label: 'Strength', unit: 'deg/A', min: 0, max: 1 },
      {
        id: 'torquetilt_strength_regen',
        label: 'Strength (Regen)',
        unit: 'deg/A',
        min: 0,
        max: 1,
      },
      {
        id: 'torquetilt_start_current',
        label: 'Start Current Threshold',
        unit: 'A',
        min: 0,
        max: 100,
      },
      { id: 'torquetilt_angle_limit', label: 'Tiltback Angle Limit', unit: 'deg', min: 0, max: 30 },
      { id: 'torquetilt_on_speed', label: 'Max Tiltback Speed', unit: 'deg/s', min: 0, max: 100 },
      {
        id: 'torquetilt_off_speed',
        label: 'Max Tiltback Release Speed',
        unit: 'deg/s',
        min: 0,
        max: 100,
      },
    ],
  },
  {
    id: 'brake',
    title: 'Brake',
    fields: [
      { id: 'braketilt_strength', label: 'Brake Tilt Strength', unit: null, min: 0, max: 20 },
      { id: 'braketilt_lingering', label: 'Brake Tilt Lingering', unit: null, min: 1, max: 5 },
    ],
  },
  {
    id: 'tiltback',
    title: 'Tiltback',
    fields: [
      { id: 'tiltback_constant', label: 'Constant Tiltback', unit: 'deg', min: -10, max: 10 },
      {
        id: 'tiltback_constant_erpm',
        label: 'Constant Tiltback ERPM',
        unit: 'ERPM',
        min: 200,
        max: 100000,
      },
      {
        id: 'tiltback_variable',
        label: 'Variable Tiltback Rate',
        unit: 'deg/1000 ERPM',
        min: 0,
        max: 5,
      },
      {
        id: 'tiltback_variable_max',
        label: 'Variable Tiltback Target',
        unit: 'deg',
        min: -10,
        max: 10,
      },
      {
        id: 'tiltback_variable_erpm',
        label: 'Variable Tiltback Start ERPM',
        unit: 'ERPM',
        min: 0,
        max: 100000,
      },
    ],
  },
]

/**
 * Field ids are typed where they are *authored*; lookups stay string-keyed because the ids come back
 * from native groups and stored profiles at runtime, where any id is possible.
 */
export const APP_TUNE_FIELD_BY_ID = new Map<string, AppTuneFieldDefinition>(
  APP_TUNE_GROUPS.flatMap((group) => group.fields.map((field) => [field.id, field])),
)

export function formatTuneValue(value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'string') return value
  if (!Number.isFinite(value)) return DASH
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
