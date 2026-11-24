import { BOARD_CONFIG_TABS, type BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'
import { remainingConfigRows } from '@/modules/board/lib/remainingConfigRows'
import { getFieldOverlay } from '@/modules/board/lib/refloatFieldOverlay'
import { formatTuneValue, tuneDisplayValue } from '@/modules/tune/lib/fields'
import {
  BOOST_DETAIL_ROWS,
  TUNE_RESPONSE_ROWS,
} from '@/modules/board/constants/extraBoardConfigRows'

const namedRows = BOARD_CONFIG_TABS.flatMap((tab) => tab.groups)
const refloatRows = new Map(
  namedRows
    .filter((group) => group.source === 'refloat')
    .flatMap((group) => group.rows.map((row) => [row.id, row] as const)),
)

const TUNE_BROWSE_GROUPS: {
  id: string
  title: string
  primaryIds: string[]
  fields: { id: string; unit: string | null }[]
}[] = [
  {
    id: 'general',
    title: 'General',
    primaryIds: ['kp', 'kp2'],
    fields: [
      { id: 'kp', unit: null },
      { id: 'kp2', unit: null },
      { id: 'kp_brake', unit: 'x' },
      { id: 'kp2_brake', unit: 'x' },
      { id: 'ki', unit: null },
      { id: 'ki_limit', unit: 'A' },
      { id: 'mahony_kp', unit: null },
      { id: 'mahony_kp_roll', unit: null },
    ],
  },
  {
    id: 'atr',
    title: 'ATR',
    primaryIds: ['atr_strength_up', 'atr_strength_down', 'atr_angle_limit'],
    fields: [
      { id: 'atr_strength_up', unit: null },
      { id: 'atr_strength_down', unit: null },
      { id: 'atr_threshold_up', unit: 'deg' },
      { id: 'atr_threshold_down', unit: 'deg' },
      { id: 'atr_speed_boost', unit: '%' },
      { id: 'atr_angle_limit', unit: 'deg' },
      { id: 'atr_on_speed', unit: 'deg/s' },
      { id: 'atr_off_speed', unit: 'deg/s' },
      { id: 'atr_response_boost', unit: 'x' },
      { id: 'atr_transition_boost', unit: 'x' },
      { id: 'atr_filter', unit: 'Hz' },
      { id: 'atr_amps_accel_ratio', unit: null },
      { id: 'atr_amps_decel_ratio', unit: null },
    ],
  },
  {
    id: 'turn_tiltback',
    title: 'Turn tiltback',
    primaryIds: ['turntilt_strength', 'turntilt_angle_limit'],
    fields: [
      { id: 'turntilt_strength', unit: null },
      { id: 'turntilt_angle_limit', unit: 'deg' },
      { id: 'turntilt_start_angle', unit: 'deg' },
      { id: 'turntilt_start_erpm', unit: 'ERPM' },
      { id: 'turntilt_speed', unit: 'deg/s' },
      { id: 'turntilt_erpm_boost', unit: '%' },
      { id: 'turntilt_erpm_boost_end', unit: 'ERPM' },
      { id: 'turntilt_yaw_aggregate', unit: 'deg' },
    ],
  },
  {
    id: 'torque_tiltback',
    title: 'Torque tiltback',
    primaryIds: ['torquetilt_strength', 'torquetilt_strength_regen', 'torquetilt_angle_limit'],
    fields: [
      { id: 'torquetilt_strength', unit: 'deg/A' },
      { id: 'torquetilt_strength_regen', unit: 'deg/A' },
      { id: 'torquetilt_start_current', unit: 'A' },
      { id: 'torquetilt_angle_limit', unit: 'deg' },
      { id: 'torquetilt_on_speed', unit: 'deg/s' },
      { id: 'torquetilt_off_speed', unit: 'deg/s' },
    ],
  },
  {
    id: 'brake',
    title: 'Brake',
    primaryIds: ['braketilt_strength', 'braketilt_lingering'],
    fields: [
      { id: 'braketilt_strength', unit: null },
      { id: 'braketilt_lingering', unit: null },
    ],
  },
  {
    id: 'tiltback',
    title: 'Tiltback',
    primaryIds: ['tiltback_constant', 'tiltback_variable', 'tiltback_variable_max'],
    fields: [
      { id: 'tiltback_constant', unit: 'deg' },
      { id: 'tiltback_constant_erpm', unit: 'ERPM' },
      { id: 'tiltback_variable', unit: 'deg/1000 ERPM' },
      { id: 'tiltback_variable_max', unit: 'deg' },
      { id: 'tiltback_variable_erpm', unit: 'ERPM' },
    ],
  },
]

const tuneGroups: BoardConfigGroup[] = TUNE_BROWSE_GROUPS.map((group) => ({
  title: group.title,
  source: 'refloat',
  primaryIds: group.primaryIds,
  rows: group.fields.map(
    (field) =>
      refloatRows.get(field.id) ?? {
        id: field.id,
        label: getFieldOverlay(field.id)?.label ?? field.id,
        format: (value) =>
          value == null
            ? '—'
            : `${formatTuneValue(tuneDisplayValue(field.id, value))}${field.unit ? ` ${field.unit}` : ''}`,
      },
  ),
}))
tuneGroups.push(
  { title: 'Current boosts', source: 'refloat', rows: BOOST_DETAIL_ROWS, advanced: true },
  { title: 'Tilt response', source: 'refloat', rows: TUNE_RESPONSE_ROWS, advanced: true },
)
const tuneIds = new Set(tuneGroups.flatMap((group) => group.rows.map((row) => row.id)))
const coveredRefloat = new Set([...refloatRows.keys(), ...tuneIds])
const coveredMotor = new Set(
  namedRows
    .filter((group) => group.source === 'motor')
    .flatMap((group) => group.rows.map((row) => row.id)),
)
const tabs: { id: string; label: string; groups: BoardConfigGroup[] }[] = [
  ...BOARD_CONFIG_TABS.filter((tab) => tab.id === 'quick'),
  ...BOARD_CONFIG_TABS.filter((tab) => tab.id !== 'quick' && tab.id !== 'other'),
  { id: 'tune', label: 'Tune', groups: tuneGroups },
  ...BOARD_CONFIG_TABS.filter((tab) => tab.id === 'other'),
]

function refloatDestination(id: string): string {
  if (id.startsWith('leds.') || id.startsWith('hardware.leds.')) return 'leds'
  if (id.startsWith('haptic.') || id.includes('beep')) return 'haptic'
  if (id.startsWith('bms.')) return 'battery'
  if (id.startsWith('remote') || id.startsWith('inputtilt_')) return 'remote'
  if (/^(atr[._]|torque_?tilt[._]|turn_?tilt[._]|booster_|brkbooster_|noseangling_)/.test(id))
    return 'tune'
  if (id.startsWith('startup_') || id === 'enable_quickstop') return 'start-stop'
  if (id === 'tiltback_speed') return 'speed'
  if (id === 'hardware.swap_footpad_adcs') return 'footpad'
  return 'other'
}

function motorDestination(id: string): string {
  if (/^(bms\.|si_battery_|l_in_current_|l_watt_|m_batt_)/.test(id)) return 'battery'
  return 'motor'
}

export function boardConfigTabs(
  refloat?: Record<string, number | boolean | undefined>,
  motor?: Record<string, number | boolean | undefined>,
) {
  const extras = [
    {
      source: 'refloat' as const,
      rows: remainingConfigRows(refloat, coveredRefloat),
      destination: refloatDestination,
    },
    {
      source: 'motor' as const,
      rows: remainingConfigRows(motor, coveredMotor),
      destination: motorDestination,
    },
  ]
  return tabs.map((tab) => {
    const groups: BoardConfigGroup[] = tab.groups.map((group) => {
      const values = group.source === 'refloat' ? refloat : motor
      return {
        ...group,
        rows: values
          ? group.rows.filter((row) => values[row.id] !== undefined)
          : group.advanced
            ? []
            : group.rows,
      }
    })
    for (const extra of extras) {
      const rows = extra.rows.filter((row) => extra.destination(row.id) === tab.id)
      if (rows.length)
        groups.push({
          title:
            tab.id === 'other'
              ? 'Other board config'
              : extra.source === 'motor'
                ? 'Controller setup'
                : 'More settings',
          source: extra.source,
          rows,
          advanced: true,
        })
    }
    return { ...tab, groups: groups.filter((group) => group.rows.length > 0) }
  })
}
