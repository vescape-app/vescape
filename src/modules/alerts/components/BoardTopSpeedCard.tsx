import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { speedFromKmh, speedInputToKmh, speedUnit } from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import { SpeedometerIcon } from 'phosphor-react-native'

import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { theme } from '@/constants/theme'

const BOARD_TOP_SPEED_MIN = 5
const BOARD_TOP_SPEED_MAX = 150

/**
 * Board Top Speed stepper card (controlled). Scales the speed gauge full-scale and the speed alert
 * preset thresholds. Board-owned (#254): the caller supplies the current value and persists changes
 * (the active Board in Settings, or a draft in the add-board wizard).
 */
export function BoardTopSpeedCard({
  value,
  onChange,
}: {
  value: number
  onChange: (kmh: number) => void
}) {
  const distanceUnit = useDistanceUnit()
  const setTopSpeed = (next: number) => {
    const clamped = speedInputToKmh(
      next,
      value,
      distanceUnit,
      BOARD_TOP_SPEED_MIN,
      BOARD_TOP_SPEED_MAX,
    )
    if (clamped === value) return
    onChange(clamped)
  }

  return (
    <SettingsCard>
      <SettingsRow
        icon={SpeedometerIcon}
        iconColor={theme.palette.orange.color}
        label="Board top speed"
        hint="Fastest you consider yourself capable of riding this board. Scales speed gauges and alerts"
        right={
          <Stepper
            value={speedFromKmh(value, distanceUnit)}
            formatValue={(v) => Number(v.toFixed(1)).toString()}
            unit={speedUnit(distanceUnit)}
            min={speedFromKmh(BOARD_TOP_SPEED_MIN, distanceUnit)}
            max={speedFromKmh(BOARD_TOP_SPEED_MAX, distanceUnit)}
            step={(v, direction) => stepDelta(v, direction, 5)}
            onChange={setTopSpeed}
          />
        }
      />
    </SettingsCard>
  )
}
