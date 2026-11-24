import {
  onOff,
  percent,
  temperature,
  unit,
  type ConfigRow,
} from '@/modules/board/lib/boardConfigReadout'

const choice = (labels: string[]) => (value: number | boolean | undefined) =>
  typeof value === 'number' ? (labels[value] ?? `Unknown (${value})`) : '—'
const row = (
  id: string,
  label: string,
  format = unit('', 2),
  description?: string,
): ConfigRow<string> => ({
  id,
  label,
  format,
  description,
})

export const HAPTIC_MAIN_ROWS = [
  row('is_beeper_enabled', 'External buzzer (servo/PPM)', onOff),
  row('is_footbeep_enabled', 'Beep on sensor fault', onOff),
  row('haptic.duty.frequency', 'Warning tone frequency', unit('Hz', 0)),
  row('haptic.duty.strength', 'Warning tone strength', unit('V', 2)),
  row('haptic.error.frequency', 'Error tone frequency', unit('Hz', 0)),
  row('haptic.error.strength', 'Error tone strength', unit('V', 2)),
  row('haptic.vibrate.frequency', 'Vibration frequency', unit('Hz', 0)),
  row('haptic.vibrate.strength', 'Vibration strength', unit('A', 1)),
]
export const HAPTIC_DETAIL_ROWS = [
  row('haptic.duty_solid_offset', 'Solid tone duty offset', percent),
  row('haptic.current_threshold', 'Solid tone current threshold', percent),
  row('haptic.min_strength', 'Minimum strength', percent),
  row('haptic.max_strength_speed', 'Full strength at', unit('km/h', 1)),
  row('haptic.strength_curvature', 'Strength curve', unit('', 2)),
]
export const START_STOP_EXTRA_ROWS = [
  row('parking_brake_mode', 'Parking brake', choice(['Always', 'Idle', 'Never'])),
  row('brake_current', 'Brake current', unit('A', 1)),
]
export const SPEED_EXTRA_ROWS = [row('tiltback_speed', 'Speed threshold', unit('km/h', 0))]
export const FOOTPAD_EXTRA_ROWS = [row('hardware.swap_footpad_adcs', 'Swap footpad zones', onOff)]
export const BOOST_DETAIL_ROWS = [
  row('booster_angle', 'Booster start angle', unit('°', 1)),
  row('booster_ramp', 'Booster ramp angle', unit('°', 1)),
  row('brkbooster_angle', 'Brake booster start angle', unit('°', 1)),
  row('brkbooster_ramp', 'Brake booster ramp angle', unit('°', 1)),
]
export const TUNE_RESPONSE_ROWS = [
  row('noseangling_speed', 'Nose angling speed', unit('°/s', 1)),
  row('atr.transition_boost', 'ATR transition boost', unit('x', 1)),
  ...['atr', 'torque_tilt'].flatMap((prefix) => {
    const name = prefix === 'atr' ? 'ATR' : 'Torque tilt'
    return [
      row(`${prefix}.filter.time_constant`, `${name} smoothing`, unit('s', 2)),
      row(`${prefix}.filter.on_speed_time_constant`, `${name} on-speed smoothing`, unit('s', 2)),
      row(`${prefix}.filter.off_speed_time_constant`, `${name} off-speed smoothing`, unit('s', 2)),
      row(`${prefix}.filter.on_speed_limit`, `${name} max tiltback speed`, unit('°/s', 1)),
      row(`${prefix}.filter.off_speed_limit`, `${name} max release speed`, unit('°/s', 1)),
    ]
  }),
  row('turn_tilt.filter.time_constant', 'Turn tilt smoothing', unit('s', 2)),
]
export const PACKAGE_ROWS = [
  row('disabled', 'Disable Refloat', onOff),
  row('persistent_fatal_error', 'Persistent fatal error', onOff),
]
export const REMOTE_ROWS = [
  row('inputtilt_remote_type', 'Remote input', choice(['None', 'UART', 'PPM'])),
  row('inputtilt_angle_limit', 'Remote tilt angle limit', unit('°', 1)),
  row('inputtilt_speed', 'Remote tilt speed', unit('°/s', 1)),
  row('inputtilt_invert_throttle', 'Invert throttle', onOff),
  row('inputtilt_deadband', 'Throttle deadband', percent),
  row('remote_throttle_current_max', 'Throttle current limit', unit('A', 1)),
  row('remote.max_move_speed', 'Remote move speed limit', unit('km/h', 1)),
  row('remote_throttle_grace_period', 'Throttle grace period', unit('s', 1)),
  row('remote.filter.time_constant', 'Remote smoothing', unit('s', 2)),
]
export const BMS_ROWS = [
  row('bms.enabled', 'BMS integration', onOff),
  row('bms.cell_lv_threshold', 'Cell low voltage threshold', unit('V', 2)),
  row('bms.cell_hv_threshold', 'Cell high voltage threshold', unit('V', 2)),
  row('bms.cell_balance_threshold', 'Cell balance threshold', unit('V', 2)),
  row('bms.cell_ht_threshold', 'Cell high temperature threshold', temperature(0)),
  row('bms.cell_lt_threshold', 'Cell low temperature threshold', temperature(0)),
  row('bms.bms_ht_threshold', 'BMS high temperature threshold', temperature(0)),
]
