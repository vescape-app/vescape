import {
  BATTERY_CONFIG_ROWS,
  DUTY_CONFIG_ROWS,
  FOOTPAD_CONFIG_ROWS,
  IMU_CONFIG_ROWS,
  MOTOR_CURRENT_CONFIG_ROWS,
  SPEED_CONFIG_ROWS,
  STATE_CONFIG_ROWS,
} from '@/modules/board/constants/boardConfigRows'
import {
  BATTERY_CURRENT_MOTOR_CONFIG_ROWS,
  BATTERY_MOTOR_CONFIG_ROWS,
  CONTROLLER_TEMP_CONFIG_ROWS,
  DUTY_MOTOR_CONFIG_ROWS,
  MOTOR_CURRENT_MOTOR_CONFIG_ROWS,
  MOTOR_TEMP_CONFIG_ROWS,
  SPEED_MOTOR_CONFIG_ROWS,
} from '@/modules/board/constants/motorConfigRows'
import {
  BMS_ROWS,
  HAPTIC_MAIN_ROWS,
  HAPTIC_DETAIL_ROWS,
  LED_MAIN_ROWS,
  LED_DETAIL_ROWS,
  LED_HARDWARE_ROWS,
  REMOTE_ROWS,
  START_STOP_EXTRA_ROWS,
} from '@/modules/board/constants/extraBoardConfigRows'
import type { ConfigRow } from '@/modules/board/lib/boardConfigReadout'

export interface BoardConfigGroup {
  title: string
  source: 'refloat' | 'motor'
  rows: ConfigRow<string>[]
  /** Less frequently changed setup, shown under the tab's disclosure when it is large. */
  advanced?: boolean
  /** When the tab is large, keep just these fields in this group visible initially. */
  primaryIds?: string[]
}

/** The same row definitions used alongside live telemetry, grouped for browsing a Board's setup. */
export const BOARD_CONFIG_TABS: { id: string; label: string; groups: BoardConfigGroup[] }[] = [
  {
    id: 'quick',
    label: 'Quick',
    groups: [
      {
        title: 'Footpad and dismount',
        source: 'refloat',
        rows: FOOTPAD_CONFIG_ROWS.filter((row) =>
          [
            'fault_is_dual_switch',
            'enable_quickstop',
            'fault_moving_fault_disabled',
            'fault_delay_switch_half',
            'fault_delay_switch_full',
          ].includes(row.id),
        ),
      },
      {
        title: 'Startup',
        source: 'refloat',
        rows: STATE_CONFIG_ROWS.filter((row) =>
          [
            'startup_simplestart_enabled',
            'startup_pushstart_enabled',
            'startup_dirtylandings_enabled',
            'fault_reversestop_enabled',
          ].includes(row.id),
        ),
      },
      {
        title: 'Lights',
        source: 'refloat',
        rows: LED_MAIN_ROWS.filter((row) =>
          [
            'leds.front.brightness',
            'leds.rear.brightness',
            'leds.headlights.brightness',
            'leds.taillights.brightness',
            'leds.front.mode',
            'leds.rear.mode',
          ].includes(row.id),
        ),
      },
    ],
  },
  {
    id: 'start-stop',
    label: 'Start/stop',
    groups: [
      {
        title: 'Startup and dismount',
        source: 'refloat',
        rows: [
          ...STATE_CONFIG_ROWS,
          ...FOOTPAD_CONFIG_ROWS.filter((row) => row.id === 'enable_quickstop'),
        ],
      },
      { title: 'Braking at rest', source: 'refloat', rows: START_STOP_EXTRA_ROWS },
    ],
  },
  {
    id: 'leds',
    label: 'LEDs',
    groups: [
      { title: 'Lights', source: 'refloat', rows: LED_MAIN_ROWS },
      {
        title: 'Patterns and status lights',
        source: 'refloat',
        rows: LED_DETAIL_ROWS,
        advanced: true,
      },
      { title: 'LED wiring', source: 'refloat', rows: LED_HARDWARE_ROWS, advanced: true },
    ],
  },
  {
    id: 'haptic',
    label: 'Haptic',
    groups: [
      { title: 'Feedback and beeps', source: 'refloat', rows: HAPTIC_MAIN_ROWS },
      { title: 'Feedback response', source: 'refloat', rows: HAPTIC_DETAIL_ROWS, advanced: true },
    ],
  },
  {
    id: 'remote',
    label: 'Remote',
    groups: [{ title: 'Remote control', source: 'refloat', rows: REMOTE_ROWS }],
  },
  {
    id: 'motor',
    label: 'Motor',
    groups: [
      { title: 'Motor current limits', source: 'motor', rows: MOTOR_CURRENT_MOTOR_CONFIG_ROWS },
      { title: 'Battery current limits', source: 'motor', rows: BATTERY_CURRENT_MOTOR_CONFIG_ROWS },
      {
        title: 'Current boosts',
        source: 'refloat',
        rows: MOTOR_CURRENT_CONFIG_ROWS.filter((row) =>
          ['booster_current', 'brkbooster_current'].includes(row.id),
        ),
      },
    ],
  },
  {
    id: 'footpad',
    label: 'Footpad',
    groups: [{ title: 'Board config', source: 'refloat', rows: FOOTPAD_CONFIG_ROWS }],
  },
  {
    id: 'imu',
    label: 'IMU',
    groups: [{ title: 'Board config', source: 'refloat', rows: IMU_CONFIG_ROWS }],
  },
  {
    id: 'speed',
    label: 'Speed',
    groups: [
      { title: 'Board config', source: 'refloat', rows: SPEED_CONFIG_ROWS },
      { title: 'Motor config', source: 'motor', rows: SPEED_MOTOR_CONFIG_ROWS },
    ],
  },
  {
    id: 'duty',
    label: 'Duty cycle',
    groups: [
      { title: 'Board config', source: 'refloat', rows: DUTY_CONFIG_ROWS },
      { title: 'Motor config', source: 'motor', rows: DUTY_MOTOR_CONFIG_ROWS },
    ],
  },
  {
    id: 'battery',
    label: 'Battery',
    groups: [
      {
        title: 'Board config',
        source: 'refloat',
        rows: BATTERY_CONFIG_ROWS,
        primaryIds: ['tiltback_lv', 'tiltback_hv'],
      },
      { title: 'Motor config', source: 'motor', rows: BATTERY_MOTOR_CONFIG_ROWS },
      { title: 'Battery current limits', source: 'motor', rows: BATTERY_CURRENT_MOTOR_CONFIG_ROWS },
      { title: 'BMS protection', source: 'refloat', rows: BMS_ROWS, advanced: true },
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    groups: [
      { title: 'Controller temperature', source: 'motor', rows: CONTROLLER_TEMP_CONFIG_ROWS },
      { title: 'Motor temperature', source: 'motor', rows: MOTOR_TEMP_CONFIG_ROWS },
    ],
  },
  { id: 'other', label: 'Other', groups: [] },
]
