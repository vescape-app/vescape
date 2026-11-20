import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  getRecentRideStats,
  getProfileStatsSnapshot,
  type ProfileStats,
  type ProfileStatsSnapshot,
} from 'vescape-core'

import { selectInitialMonth } from '@/modules/profile/lib/profileStats'

/** How far back "Today" reaches: a rolling window, so a ride across midnight never drops out. */
const TODAY_WINDOW_MS = 12 * 60 * 60_000

/** Totals of the rides still going on or finished within the last 12 hours, shown as Today. */
export function getTodayStats(): Promise<ProfileStats> {
  return getRecentRideStats(Date.now() - TODAY_WINDOW_MS)
}

export const EMPTY_PROFILE_STATS: ProfileStats = {
  distanceM: null,
  rideCount: 0,
  rideTimeMs: 0,
  topSpeedKmh: 0,
  avgSpeedKmh: 0,
  longestRideM: null,
  batteryUsedWh: null,
  batteryRegenWh: null,
  topSpeedRideId: null,
  longestRideId: null,
}

/**
 * Lifetime, per-month, and today's riding totals read from native.
 *
 * Reloaded on focus, not just on mount: a ride recorded while the screen sat mounted behind another
 * one would otherwise leave lifetime stats frozen below what Ride History already shows.
 */
export function useProfileStats(active = true, includeMonthStats = false) {
  const [total, setTotal] = useState<ProfileStats>(EMPTY_PROFILE_STATS)
  const [monthly, setMonthly] = useState<ProfileStats>(EMPTY_PROFILE_STATS)
  const [today, setToday] = useState<ProfileStats>(EMPTY_PROFILE_STATS)
  const [monthStats, setMonthStats] = useState<NonNullable<ProfileStatsSnapshot['monthStats']>>([])
  const [selectedMonth, setSelectedMonth] = useState(selectInitialMonth([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadedRef = useRef(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    if (!loadedRef.current) setLoading(true)
    setError(null)
    try {
      const [snapshot, todayStats] = await Promise.all([
        getProfileStatsSnapshot({ includeMonthStats }),
        getTodayStats(),
      ])
      if (request !== requestRef.current) return
      const month = selectInitialMonth(snapshot.months)
      const selected = snapshot.selectedMonth
      const matches = month.year === selected.year && month.month === selected.month
      const monthlyStats = matches
        ? snapshot.monthly
        : (snapshot.monthStats?.find(
            (entry) => entry.year === month.year && entry.month === month.month,
          )?.stats ?? (await getProfileStatsSnapshot(month)).monthly)
      if (request !== requestRef.current) return
      setTotal(snapshot.total)
      setMonthStats(snapshot.monthStats ?? [])
      setSelectedMonth(month)
      setMonthly(monthlyStats)
      setToday(todayStats)
      loadedRef.current = true
    } catch (err) {
      if (request !== requestRef.current) return
      setTotal(EMPTY_PROFILE_STATS)
      setMonthly(EMPTY_PROFILE_STATS)
      setToday(EMPTY_PROFILE_STATS)
      setMonthStats([])
      loadedRef.current = false
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [includeMonthStats])

  useFocusEffect(
    useCallback(() => {
      if (!active) return
      void refresh()
      return () => {
        requestRef.current++
      }
    }, [active, refresh]),
  )

  return {
    total,
    monthly,
    /** Totals of the current local day, refreshed with the rest. */
    today,
    monthStats,
    selectedMonth,
    loading,
    error,
    /** Successful zero-ride result; callers render `error` first when the read failed. */
    empty: total.rideCount === 0,
  }
}
