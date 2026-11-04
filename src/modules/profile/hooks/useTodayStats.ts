import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import type { ProfileStats } from 'vescape-core'

import { EMPTY_PROFILE_STATS, getTodayStats } from '@/modules/profile/hooks/useProfileStats'

const REFRESH_MS = 30_000

/**
 * Today's totals alone, for always-visible surfaces. Re-read on focus and every 30 s so a ride
 * recording in the background shows up without leaving the screen.
 */
export function useTodayStats(): ProfileStats {
  const [today, setToday] = useState<ProfileStats>(EMPTY_PROFILE_STATS)

  const refresh = useCallback(() => {
    getTodayStats().then(setToday, () => setToday(EMPTY_PROFILE_STATS))
  }, [])

  useFocusEffect(refresh)

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(interval)
  }, [refresh])

  return today
}
