import { ClockCounterClockwiseIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import {
  IconButtonExtension,
  IconButtonExtensionStat,
} from '@/components/controls/IconButtonExtension'
import { rideDistanceFromMeters } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { useTodayStats } from '@/modules/profile/hooks/useTodayStats'

interface HistoryButtonProps {
  onPress: () => void
}

/** Opens History. After a ride today, the day's distance and ride time stack above the button. */
export function HistoryButton({ onPress }: HistoryButtonProps) {
  const today = useTodayStats()
  const distanceUnit = useDistanceUnit()
  const distance = rideDistanceFromMeters(today.distanceM ?? 0, distanceUnit).toFixed(1)
  const minutes = today.rideTimeMs / 60_000
  // Under an hour, whole minutes read better than `0.4 h`.
  const [time, timeUnit] =
    minutes < 60 ? [String(Math.round(minutes)), 'min'] : [(minutes / 60).toFixed(1), 'h']

  return (
    <IconButtonExtension
      onPress={onPress}
      testID="history-today-stats"
      accessibilityLabel={`Today ${distance} ${distanceUnit}, ${time} ${timeUnit}`}
      extension={
        today.rideCount > 0 ? (
          <>
            <IconButtonExtensionStat value={distance} unit={distanceUnit} />
            <IconButtonExtensionStat value={time} unit={timeUnit} />
          </>
        ) : null
      }
    >
      <IconButton
        icon={ClockCounterClockwiseIcon}
        size="lg"
        onPress={onPress}
        testID="history-button"
      />
    </IconButtonExtension>
  )
}
