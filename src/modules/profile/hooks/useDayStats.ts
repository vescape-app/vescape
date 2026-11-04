import { getDayStats, type RideDay } from 'vescape-core'

import { calendarDayKey } from '@/helpers/calendarDay'
import { useAsyncRead } from '@/hooks/useAsyncRead'
import { EMPTY_PROFILE_STATS } from '@/modules/profile/hooks/useProfileStats'

/** Riding totals of one local day, read from native. */
export function useDayStats(day: RideDay) {
  return useAsyncRead(() => getDayStats(day), EMPTY_PROFILE_STATS, calendarDayKey(day))
}
