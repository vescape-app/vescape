import { useMemo } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { riderStats, type RiderReadings } from '@/modules/group-ride/lib/riderStats'

export function useRiderStats(presence: RiderReadings | null) {
  const distanceUnit = useDistanceUnit()
  return useMemo(() => riderStats(presence, distanceUnit), [presence, distanceUnit])
}
