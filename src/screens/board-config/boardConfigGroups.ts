import { BOARD_CONFIG_TABS, type BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'
import { remainingConfigRows } from '@/modules/board/lib/remainingConfigRows'
import { APP_TUNE_GROUPS, formatTuneValue, tuneDisplayValue } from '@/modules/tune/lib/fields'

const namedRows = BOARD_CONFIG_TABS.flatMap((tab) => tab.groups)
const refloatRows = new Map(
  namedRows
    .filter((group) => group.source === 'refloat')
    .flatMap((group) => group.rows.map((row) => [row.id, row] as const)),
)
const tunePrimaryIds: Record<string, string[]> = {
  general: ['kp', 'kp2'],
  atr: ['atr_strength_up', 'atr_strength_down', 'atr_angle_limit'],
  turn_tiltback: ['turntilt_strength', 'turntilt_angle_limit'],
  torque_tiltback: ['torquetilt_strength', 'torquetilt_strength_regen', 'torquetilt_angle_limit'],
  brake: ['braketilt_strength', 'braketilt_lingering'],
  tiltback: ['tiltback_constant', 'tiltback_variable', 'tiltback_variable_max'],
}
const tuneGroups: BoardConfigGroup[] = APP_TUNE_GROUPS.map((group) => ({
  title: group.title,
  source: 'refloat',
  primaryIds: tunePrimaryIds[group.id],
  rows: group.fields.map(
    (field) =>
      refloatRows.get(field.id) ?? {
        id: field.id,
        label: field.label,
        format: (value) =>
          value == null
            ? '—'
            : `${formatTuneValue(tuneDisplayValue(field.id, value))}${field.unit ? ` ${field.unit}` : ''}`,
      },
  ),
}))
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
  { id: 'other', label: 'Other', groups: [] },
]

function refloatDestination(id: string): string {
  if (id.startsWith('leds.') || id.startsWith('hardware.leds.')) return 'leds'
  if (id.startsWith('haptic.') || id.includes('beep')) return 'haptic'
  if (id.startsWith('bms.')) return 'battery'
  if (id.startsWith('remote') || id.startsWith('inputtilt_')) return 'remote'
  if (/^(atr[._]|torque_tilt[._]|turn_tilt[._]|booster_|brkbooster_|noseangling_)/.test(id))
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

/** Newer firmware fields stay reachable in their topic, without guessing their units. */
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
