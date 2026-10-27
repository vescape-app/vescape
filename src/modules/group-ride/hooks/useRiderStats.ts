import { useMemo } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { riderStats } from '@/modules/group-ride/lib/riderStats'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

/** Format one roster rider with the current display units. */
export function useRiderStats(presence: RosterRider['presence']) {
  const distanceUnit = useDistanceUnit()
  return useMemo(() => riderStats(presence, distanceUnit), [presence, distanceUnit])
}
