import {
  erpm,
  percent,
  temperature,
  unit,
  type MotorConfigRow,
} from '@/modules/board/lib/boardConfigReadout'

const temp = temperature(0)

export const CONTROLLER_TEMP_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_temp_fet_start', label: 'Power limiting starts at', format: temp },
  { id: 'l_temp_fet_end', label: 'Power fully cut at', format: temp },
]

export const MOTOR_TEMP_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_temp_motor_start', label: 'Power limiting starts at', format: temp },
  { id: 'l_temp_motor_end', label: 'Power fully cut at', format: temp },
]

const amps = unit('A', 0)

export const MOTOR_CURRENT_MOTOR_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_current_max', label: 'Motor current limit', format: amps },
  { id: 'l_current_min', label: 'Braking current limit', format: amps },
  { id: 'l_abs_current_max', label: 'Absolute current cutoff', format: amps },
]

export const BATTERY_CURRENT_MOTOR_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_in_current_max', label: 'Battery current limit', format: amps },
  { id: 'l_in_current_min', label: 'Regen current limit', format: amps },
]

export const BATTERY_MOTOR_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_battery_cut_start', label: 'Power limiting starts at', format: (v) => voltage(v) },
  { id: 'l_battery_cut_end', label: 'Power fully cut at', format: (v) => voltage(v) },
  { id: 'l_min_vin', label: 'Minimum input voltage', format: (v) => voltage(v) },
  { id: 'l_max_vin', label: 'Maximum input voltage', format: (v) => voltage(v) },
]

export const DUTY_MOTOR_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_max_duty', label: 'Controller duty limit', format: percent },
]

export const SPEED_MOTOR_CONFIG_ROWS: MotorConfigRow[] = [
  { id: 'l_max_erpm', label: 'Forward ERPM limit', format: erpm },
  { id: 'l_min_erpm', label: 'Reverse ERPM limit', format: erpm },
]

function voltage(value: number | boolean | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)} V` : '—'
}
