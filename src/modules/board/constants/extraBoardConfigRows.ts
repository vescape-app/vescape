import { onOff, percent, unit, type ConfigRow } from '@/modules/board/lib/boardConfigReadout'

// Labels, units and enum ordering checked against shared/fixtures/refloat-schema.
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
const modes = [
  'Solid',
  'Fade',
  'Pulse',
  'Strobe',
  'Knight Rider',
  'Felony',
  'Rainbow Cycle',
  'Rainbow Fade',
  'Rainbow Roll',
]
const colors = [
  'Black',
  'White (full)',
  'White (rgb)',
  'White (single)',
  'Red',
  'Ferrari',
  'Flame',
  'Coral',
  'Sunset',
  'Sunrise',
  'Gold',
  'Orange',
  'Yellow',
  'Banana',
  'Lime',
  'Acid',
  'Sage',
  'Green',
  'Mint',
  'Tiffany',
  'Cyan',
  'Steel',
  'Sky',
  'Azure',
  'Sapphire',
  'Blue',
  'Violet',
  'Amethyst',
  'Magenta',
  'Pink',
  'Fuchsia',
  'Lavender',
]
const transitions = ['Fade', 'Fade Out Fade In', 'Cipher', 'Mono Cipher']

export const LED_MAIN_ROWS = [
  row('leds.on', 'LEDs', onOff),
  row('leds.headlights_on', 'Headlights', onOff),
  row(
    'leds.front.brightness',
    'Front brightness',
    percent,
    'How bright the front strip is with headlights off.',
  ),
  row(
    'leds.rear.brightness',
    'Rear brightness',
    percent,
    'How bright the rear strip is with headlights off.',
  ),
  row(
    'leds.headlights.brightness',
    'Headlight brightness',
    percent,
    'How bright the forward-facing lights are with headlights on. Follows your riding direction.',
  ),
  row(
    'leds.taillights.brightness',
    'Taillight brightness',
    percent,
    'How bright the backward-facing lights are with headlights on. Follows your riding direction.',
  ),
  row(
    'leds.front.mode',
    'Front pattern',
    choice(modes),
    'The effect on the front strip with headlights off.',
  ),
  row(
    'leds.rear.mode',
    'Rear pattern',
    choice(modes),
    'The effect on the rear strip with headlights off.',
  ),
]

export const LED_DETAIL_ROWS = [
  row('leds.headlights_transition', 'Headlight transition', choice(transitions)),
  row('leds.direction_transition', 'Direction transition', choice(transitions)),
  row('leds.lights_off_when_lifted', 'Lights off when lifted', onOff),
  row('leds.status_on_front_when_lifted', 'Status on front when lifted', onOff),
  ...['front', 'rear', 'headlights', 'taillights', 'status_idle'].flatMap((strip) => {
    const name = {
      front: 'Front',
      rear: 'Rear',
      headlights: 'Headlight',
      taillights: 'Taillight',
      status_idle: 'Idle status',
    }[strip]!
    return [
      row(`leds.${strip}.mode`, `${name} pattern`, choice(modes)),
      row(`leds.${strip}.brightness`, `${name} brightness`, percent),
      row(`leds.${strip}.color1`, `${name} primary color`, choice(colors)),
      row(`leds.${strip}.color2`, `${name} secondary color`, choice(colors)),
      row(`leds.${strip}.speed`, `${name} animation speed`, unit('', 2)),
    ].filter((field) => !LED_MAIN_ROWS.some((main) => main.id === field.id))
  }),
  row('leds.status.brightness_headlights_off', 'Status brightness, headlights off', percent),
  row('leds.status.brightness_headlights_on', 'Status brightness, headlights on', percent),
  row('leds.status.show_sensors_while_running', 'Show sensors while riding', onOff),
  row('leds.status.duty_threshold', 'Status duty threshold', percent),
  row('leds.status.motor_utilization_threshold', 'Status motor utilization threshold', percent),
  row('leds.status.red_bar_percentage', 'Status red bar portion', percent),
  row('leds.status.idle_timeout', 'Status idle timeout', unit('s', 0)),
]

export const LED_HARDWARE_ROWS = [
  row(
    'hardware.leds.mode',
    'LED output',
    choice(['Off', 'Internal', 'External', 'Internal and External']),
  ),
  row(
    'hardware.leds.pin',
    'LED pin',
    choice(['PPM/Servo pin', 'Dedicated LED pin', 'JetFleet F6 v1 pin']),
  ),
  row('hardware.leds.pin_config', 'LED pin pullup', choice(['Pullup to 5V', 'No Pullup'])),
  ...['status', 'front', 'rear'].flatMap((strip) => {
    const name = { status: 'Status', front: 'Front', rear: 'Rear' }[strip]!
    return [
      row(
        `hardware.leds.${strip}.order`,
        `${name} strip position`,
        choice(['Not Present', '1st', '2nd', '3rd']),
      ),
      row(`hardware.leds.${strip}.count`, `${name} LED count`, unit('', 0)),
      row(
        `hardware.leds.${strip}.color_order`,
        `${name} color order`,
        choice(['GRB', 'GRBW', 'RGB', 'WRGB']),
      ),
      row(`hardware.leds.${strip}.reverse`, `Reverse ${strip} direction`, onOff),
    ]
  }),
]

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
  row('bms.cell_ht_threshold', 'Cell high temperature threshold', unit('°C', 0)),
  row('bms.cell_lt_threshold', 'Cell low temperature threshold', unit('°C', 0)),
  row('bms.bms_ht_threshold', 'BMS high temperature threshold', unit('°C', 0)),
]
