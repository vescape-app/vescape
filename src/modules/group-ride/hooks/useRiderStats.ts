import { useMemo } from 'react'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import { riderStats } from '@/modules/group-ride/lib/riderStats'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

/** Format one roster rider with the current display units. */
export function useRiderStats(presence: RosterRider['presence']) {
  const units = useUnitSystem()
  return useMemo(() => riderStats(presence, units), [presence, units])
}
