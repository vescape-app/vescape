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
  const setTopSpeed = (next: number) => {
    const clamped = Math.min(BOARD_TOP_SPEED_MAX, Math.max(BOARD_TOP_SPEED_MIN, next))
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
            value={value}
            unit="km/h"
            min={BOARD_TOP_SPEED_MIN}
            max={BOARD_TOP_SPEED_MAX}
            step={5}
            onChange={setTopSpeed}
          />
        }
      />
    </SettingsCard>
  )
}
