import { useMemo } from 'react'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { riderStats, type RiderReadings } from '@/modules/group-ride/lib/riderStats'

export function useRiderStats(presence: RiderReadings | null) {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
  return useMemo(
    () => riderStats(presence, distanceUnit, temperatureUnit),
    [presence, distanceUnit, temperatureUnit],
  )
}
