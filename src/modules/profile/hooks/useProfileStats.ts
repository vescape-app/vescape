import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { getProfileStatsSnapshot, type ProfileStats, type ProfileStatsMonth } from 'vescape-core'

import { selectInitialMonth } from '@/modules/profile/lib/profileStats'

export const EMPTY_PROFILE_STATS: ProfileStats = {
  distanceM: null,
  rideCount: 0,
  rideTimeMs: 0,
  topSpeedKmh: 0,
  avgSpeedKmh: 0,
  longestRideM: null,
  batteryUsedWh: null,
  batteryRegenWh: null,
}

/**
 * Lifetime and per-month riding totals read from native.
 *
 * Reloaded on focus, not just on mount: a ride recorded while the screen sat mounted behind another
 * one would otherwise leave lifetime stats frozen below what Ride History already shows.
 */
export function useProfileStats(active = true) {
  const [total, setTotal] = useState<ProfileStats>(EMPTY_PROFILE_STATS)
  const [monthly, setMonthly] = useState<ProfileStats>(EMPTY_PROFILE_STATS)
  const [months, setMonths] = useState<ProfileStatsMonth[]>([])
  const [selectedMonth, setSelectedMonth] = useState<ProfileStatsMonth>(selectInitialMonth([]))
  const [loading, setLoading] = useState(true)
  const [monthLoading, setMonthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMonthRef = useRef(selectedMonth)
  selectedMonthRef.current = selectedMonth
  const loadedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    setError(null)
    try {
      const snapshot = await getProfileStatsSnapshot(
        loadedRef.current ? selectedMonthRef.current : undefined,
      )
      const availableMonths = snapshot.months
      // Keep the month the rider is looking at; fall back when it is gone (or on first load).
      const current = selectedMonthRef.current
      const keep =
        loadedRef.current &&
        availableMonths.some(
          (month) => month.year === current.year && month.month === current.month,
        )
      const month = keep ? current : selectInitialMonth(availableMonths)
      const resolvedSnapshot =
        month.year === snapshot.selectedMonth.year && month.month === snapshot.selectedMonth.month
          ? snapshot
          : await getProfileStatsSnapshot(month)
      setTotal(resolvedSnapshot.total)
      setMonths(availableMonths)
      setSelectedMonth(month)
      setMonthly(resolvedSnapshot.monthly)
      loadedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (active) void refresh()
    }, [active, refresh]),
  )

  const selectMonth = useCallback(async (month: ProfileStatsMonth) => {
    setSelectedMonth(month)
    setMonthLoading(true)
    setError(null)
    try {
      const snapshot = await getProfileStatsSnapshot(month)
      setTotal(snapshot.total)
      setMonths(snapshot.months)
      setMonthly(snapshot.monthly)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMonthLoading(false)
    }
  }, [])

  return {
    total,
    monthly,
    months,
    selectedMonth,
    loading,
    monthLoading,
    error,
    refresh,
    selectMonth,
    /** True until native has answered once — nothing recorded yet reads the same as no data. */
    empty: total.rideCount === 0,
  }
}
