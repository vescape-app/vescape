import { useMemo } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { riderStats, type RiderReadings } from '@/modules/group-ride/lib/riderStats'

/** Format one roster rider with the current display units. */
export function useRiderStats(presence: RiderReadings | null) {
  const distanceUnit = useDistanceUnit()
  return useMemo(() => riderStats(presence, distanceUnit), [presence, distanceUnit])
}
