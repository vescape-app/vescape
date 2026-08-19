import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BatteryChargingVerticalIcon,
  BatteryPlusVerticalIcon,
  ClockCountdownIcon,
  GaugeIcon,
  PathIcon,
  RepeatIcon,
  RoadHorizonIcon,
  TrophyIcon,
} from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import {
  getMonthlyProfileStats,
  getProfileStatMonths,
  getTotalProfileStats,
  type ProfileStats,
  type ProfileStatsMonth,
} from 'vescape-core'

import {
  formatDistance,
  formatDuration,
  formatEnergy,
  formatMonthLabel,
  formatSpeed,
  getAdjacentMonths,
  selectInitialMonth,
} from '@/modules/profile/lib/profileStats'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'
import { Select, type SelectOption } from '@/components/forms/Select'
import { theme } from '@/constants/theme'

const EMPTY_STATS: ProfileStats = {
  distanceM: null,
  rideCount: 0,
  rideTimeMs: 0,
  topSpeedKmh: 0,
  avgSpeedKmh: 0,
  longestRideM: null,
  batteryUsedWh: null,
  batteryRegenWh: null,
}

interface StatItem {
  key: string
  label: string
  value: string
  icon: Icon
  accent: string
}

export function RideStatsSection() {
  const [totalStats, setTotalStats] = useState<ProfileStats>(EMPTY_STATS)
  const [monthlyStats, setMonthlyStats] = useState<ProfileStats>(EMPTY_STATS)
  const [months, setMonths] = useState<ProfileStatsMonth[]>([])
  const [selectedMonth, setSelectedMonth] = useState<ProfileStatsMonth>(selectInitialMonth([]))
  const [loading, setLoading] = useState(true)
  const [monthLoading, setMonthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [total, availableMonths] = await Promise.all([
        getTotalProfileStats(),
        getProfileStatMonths(),
      ])
      const initialMonth = selectInitialMonth(availableMonths)
      const monthStats = await getMonthlyProfileStats(initialMonth)
      setTotalStats(total)
      setMonths(availableMonths)
      setSelectedMonth(initialMonth)
      setMonthlyStats(monthStats)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load on mount, setState in async continuation
    loadInitial()
  }, [loadInitial])

  const loadMonth = useCallback(async (month: ProfileStatsMonth) => {
    setSelectedMonth(month)
    setMonthLoading(true)
    setError(null)
    try {
      const stats = await getMonthlyProfileStats(month)
      setMonthlyStats(stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMonthLoading(false)
    }
  }, [])

  const totalItems = useMemo(() => statsToItems(totalStats), [totalStats])
  const monthItems = useMemo(() => statsToItems(monthlyStats), [monthlyStats])
  const adjacent = useMemo(() => getAdjacentMonths(months, selectedMonth), [months, selectedMonth])

  const monthOptions: SelectOption[] = useMemo(
    () =>
      (months.length ? months : [selectedMonth]).map((m) => ({
        label: formatMonthLabel(m),
        value: `${m.year}-${m.month}`,
      })),
    [months, selectedMonth],
  )

  const selectedMonthValue = `${selectedMonth.year}-${selectedMonth.month}`

  const handleMonthSelect = useCallback(
    (val: string) => {
      const [year, month] = val.split('-').map(Number)
      const found = months.find((m) => m.year === year && m.month === month)
      if (found) void loadMonth(found)
    },
    [months, loadMonth],
  )

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>All time</Text>
      <StatsGrid items={totalItems} />

      <View style={styles.monthHeader}>
        <Text style={styles.sectionTitle}>Monthly</Text>
        {monthLoading ? <ActivityIndicator size="small" color={theme.palette.sky.color} /> : null}
      </View>
      <PrevNextSelector
        label={formatMonthLabel(selectedMonth)}
        previousDisabled={!adjacent.previous}
        nextDisabled={!adjacent.next}
        onPrevious={() => adjacent.previous && void loadMonth(adjacent.previous)}
        onNext={() => adjacent.next && void loadMonth(adjacent.next)}
        accessibilityLabel="Select profile month"
        style={styles.monthNav}
        selectControl={
          <Select
            options={monthOptions}
            value={selectedMonthValue}
            onChange={handleMonthSelect}
            placeholder="Select month"
            style={styles.monthSelect}
          />
        }
      />
      <StatsGrid items={monthItems} />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={theme.palette.sky.color} />
        </View>
      ) : null}

      {error ? (
        <Pressable style={styles.errorCard} onPress={() => void loadInitial()}>
          <Text style={styles.errorTitle}>Could not load profile stats</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function statsToItems(stats: ProfileStats): StatItem[] {
  return [
    {
      key: 'distance',
      label: 'Distance',
      value: formatDistance(stats.distanceM),
      icon: RoadHorizonIcon,
      accent: theme.palette.sky.color,
    },
    {
      key: 'rides',
      label: 'Rides',
      value: String(stats.rideCount),
      icon: PathIcon,
      accent: theme.palette.cyan.color,
    },
    {
      key: 'rideTime',
      label: 'Ride time',
      value: formatDuration(stats.rideTimeMs),
      icon: ClockCountdownIcon,
      accent: theme.palette.purple.color,
    },
    {
      key: 'topSpeed',
      label: 'Top speed',
      value: formatSpeed(stats.topSpeedKmh),
      icon: GaugeIcon,
      accent: theme.status.warning.color,
    },
    {
      key: 'avgSpeed',
      label: 'Avg speed',
      value: formatSpeed(stats.avgSpeedKmh),
      icon: RepeatIcon,
      accent: theme.palette.cyan.color,
    },
    {
      key: 'longestRide',
      label: 'Longest ride',
      value: formatDistance(stats.longestRideM),
      icon: TrophyIcon,
      accent: theme.palette.yellow.color,
    },
    {
      key: 'used',
      label: 'Battery used',
      value: formatEnergy(stats.batteryUsedWh),
      icon: BatteryChargingVerticalIcon,
      accent: theme.palette.sky.color,
    },
    {
      key: 'regen',
      label: 'Regen',
      value: formatEnergy(stats.batteryRegenWh),
      icon: BatteryPlusVerticalIcon,
      accent: theme.palette.green.text,
    },
  ]
}

interface StatsGridProps {
  items: StatItem[]
}

function StatsGrid({ items }: StatsGridProps) {
  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const IconComponent = item.icon
        return (
          <View key={item.key} style={styles.cell}>
            <IconComponent size={18} color={item.accent} weight="duotone" />
            <Text style={styles.cellValue}>{item.value}</Text>
            <Text style={styles.cellLabel}>{item.label}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '50%',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  cellValue: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  cellLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  monthHeader: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNav: {
    maxWidth: '100%',
    width: '100%',
  },
  monthSelect: {
    flex: 1,
    height: 54,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
  loadingWrap: {
    padding: 18,
    alignItems: 'center',
  },
  errorCard: {
    backgroundColor: theme.status.error.bg,
    borderColor: theme.status.error.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  errorTitle: {
    color: theme.status.error.text,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: theme.status.error.color,
    fontSize: 12,
  },
  retryText: {
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
})
