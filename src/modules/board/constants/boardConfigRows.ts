import {
  erpm,
  isEnabled,
  millis,
  onOff,
  percent,
  unit,
  volts,
  type BoardConfigRow,
} from '@/modules/board/lib/boardConfigReadout'

/**
 * Which Refloat config fields each `/control/<metric>` screen shows beside its live telemetry.
 *
 * One file rather than a list per route: the choice of fields is domain knowledge about what
 * explains a metric, and the routes stay thin. A screen whose metric Refloat has no say over gets no
 * section here — the temperature screens read VESC motor config instead, from
 * `motorConfigRows.ts`.
 */

/**
 * What the board itself does with the two footpad sensors: when a zone counts as engaged, how long
 * it tolerates a foot coming off, and the switches that weaken that protection.
 */
export const FOOTPAD_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'fault_adc1', label: 'Zone 1 engages at', format: (v) => volts(v, 'Disabled') },
  { id: 'fault_adc2', label: 'Zone 2 engages at', format: (v) => volts(v, 'Disabled') },
  {
    id: 'fault_is_dual_switch',
    when: "You're doing lots of tricks and need one-zone riding. For tricky starts, try Simple start first.",
    description:
      "Either zone can keep the board on, so heel-lift dismount won't work. A stuck sensor can keep it running after you step off.",
    label: 'Both zones as one (Posi)',
    format: onOff,
    note: (v) =>
      isEnabled(v) ? 'Heel-lift dismount is off — either zone holds the board on.' : null,
  },
  { id: 'fault_adc_half_erpm', label: 'One zone off is a fault below', format: erpm },
  {
    id: 'fault_delay_switch_half',
    description:
      'How long one zone can stop sensing your foot before the board switches off. Applies at low speed, with Posi off.',
    label: 'One zone off, cutoff after',
    format: millis,
  },
  {
    id: 'fault_delay_switch_full',
    description: 'How long both zones can stop sensing your foot before the board can switch off.',
    label: 'Both zones off, cutoff after',
    format: millis,
  },
  {
    // Refloat's own field is the negative one ("Disable Moving Faults"), so the row is named after
    // the setting rather than inverted into "Moving faults: Active" — an inverted row reads as the
    // opposite of the toggle the rider set, which is the one thing a config readout must not do.
    id: 'fault_moving_fault_disabled',
    recommended: 'on',
    when: "Your footpad sometimes stops detecting you even though you're still standing on it, especially during hard riding.",
    description:
      'Stops the footpad from switching the board off while riding forward fast enough and fairly level. It can keep going after you step off.',
    label: 'Moving faults disabled',
    format: onOff,
    note: (v) =>
      isEnabled(v) ? 'The board will not disengage on sensors while rolling forward.' : null,
  },
  {
    id: 'fault_darkride_enabled',
    label: 'Darkride',
    format: onOff,
    note: (v) => (isEnabled(v) ? 'Riding upside down without sensors is allowed.' : null),
  },
  {
    id: 'enable_quickstop',
    description:
      'Lets you brake hard and lift your front foot as the wheel stops, with the nose tilted up.',
    label: 'Quickstop',
    format: onOff,
  },
]

/** Duty pushback: where the board starts pushing back, and how hard. */
export const DUTY_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'tiltback_duty', label: 'Pushback starts at', format: percent },
  { id: 'tiltback_duty_angle', label: 'Pushback angle', format: unit('°') },
  { id: 'tiltback_duty_speed', label: 'Pushback speed', format: unit('°/s') },
  { id: 'is_dutybeep_enabled', label: 'Beep on pushback', format: onOff },
]

/** The voltage limits that push back, both ends of the pack. */
export const BATTERY_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'tiltback_lv', label: 'Low voltage pushback at', format: (v) => volts(v, 'Off') },
  { id: 'tiltback_lv_angle', label: 'Low voltage angle', format: unit('°') },
  { id: 'tiltback_lv_speed', label: 'Low voltage speed', format: unit('°/s') },
  { id: 'tiltback_hv', label: 'High voltage pushback at', format: (v) => volts(v, 'Off') },
  { id: 'tiltback_hv_angle', label: 'High voltage angle', format: unit('°') },
  { id: 'tiltback_hv_speed', label: 'High voltage speed', format: unit('°/s') },
]

/** The angles the board refuses to keep riding at, and the filter behind the ones it reads. */
export const IMU_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'fault_pitch', label: 'Pitch cutoff', format: unit('°', 0) },
  { id: 'fault_delay_pitch', label: 'Pitch cutoff after', format: millis },
  { id: 'fault_roll', label: 'Roll cutoff', format: unit('°', 0) },
  { id: 'fault_delay_roll', label: 'Roll cutoff after', format: millis },
  { id: 'mahony_kp', label: 'Pitch KP', format: unit('', 2) },
  { id: 'mahony_kp_roll', label: 'Roll KP', format: unit('', 2) },
]

/** Nose angling with speed — the reason the board rides nose-up as it goes faster. */
export const SPEED_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'tiltback_constant', label: 'Constant tiltback', format: unit('°') },
  { id: 'tiltback_constant_erpm', label: 'Constant tiltback above', format: erpm },
  { id: 'tiltback_variable', label: 'Variable tiltback rate', format: unit('°/1000 ERPM', 2) },
  { id: 'tiltback_variable_max', label: 'Variable tiltback target', format: unit('°') },
  { id: 'tiltback_variable_erpm', label: 'Variable tiltback from', format: erpm },
  { id: 'tiltback_return_speed', label: 'Return to level speed', format: unit('°/s') },
]

/** The currents the board applies on its own, which is what the motor-current trace is made of. */
export const MOTOR_CURRENT_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'brake_current', label: 'Brake current', format: unit('A') },
  { id: 'torquetilt_start_current', label: 'Torque tilt starts at', format: unit('A') },
  { id: 'booster_current', label: 'Booster current', format: unit('A') },
  { id: 'brkbooster_current', label: 'Brake booster current', format: unit('A') },
]

/** How the board decides to engage, and how it lets go. */
export const STATE_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'startup_pitch_tolerance', label: 'Startup pitch tolerance', format: unit('°') },
  { id: 'startup_roll_tolerance', label: 'Startup roll tolerance', format: unit('°') },
  { id: 'startup_speed', label: 'Centering speed', format: unit('°/s') },
  { id: 'startup_click_current', label: 'Start/stop click', format: unit('A', 0) },
  {
    id: 'startup_simplestart_enabled',
    when: 'Most rides. Less of that awkward shuffle trying to get the board to wake up.',
    recommended: 'on',
    description:
      'Lets you start with just one footpad zone pressed. Heel-lift dismount still works.',
    label: 'Simple start',
    format: onOff,
  },
  {
    id: 'startup_pushstart_enabled',
    when: 'Most rides, especially when starting on a steep slope.',
    recommended: 'on',
    description:
      "Lets you hop onto a rolling board even if the nose isn't level yet. Needs a little speed to engage.",
    label: 'Push start',
    format: onOff,
  },
  {
    id: 'startup_dirtylandings_enabled',
    recommended: 'on',
    when: 'You like hopping curbs, jumping around or taking drops.',
    description:
      "Briefly gives you more room to land with the nose tilted after a hop. Doesn't apply after a heel-lift dismount.",
    label: 'Dirty landings',
    format: onOff,
  },
  {
    id: 'fault_reversestop_enabled',
    when: 'Usually off, unless you like rolling back to stop. A footpad that stays engaged with nobody on it needs fixing.',
    description:
      'Lets you dismount by rolling back a little. The board tilts, then switches off. Makes balancing in place harder.',
    label: 'Reverse stop',
    format: onOff,
    note: (v) => (isEnabled(v) ? 'The board disengages when it rolls backwards.' : null),
  },
]
