import { useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import type { ProfileStatsMonth, RiderStats } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { rideDistanceFromMeters, rideDistanceUnit } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import {
  useProfileStatItems,
  type OpenRecordRide,
} from '@/modules/profile/hooks/useProfileStatItems'
import { EMPTY_PROFILE_STATS } from '@/modules/profile/hooks/useProfileStats'
import { currentProfileMonth, formatMonthLabel } from '@/modules/profile/lib/profileStats'

interface MonthStats extends ProfileStatsMonth {
  stats: RiderStats
}

interface ProfileStatsDetailsProps {
  today?: RiderStats
  total: RiderStats | null
  months: readonly MonthStats[]
  loading?: boolean
  unavailable?: boolean
  onOpenRecordRide?: OpenRecordRide
}

const chartDistance = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function ProfileStatsDetails({
  today,
  total,
  months,
  loading = false,
  unavailable = false,
  onOpenRecordRide,
}: ProfileStatsDetailsProps) {
  const [selection, setSelection] = useState<string | null>(() => monthKey(currentProfileMonth()))
  const calendar = loading || unavailable ? months : fillCalendarMonths(months)
  const selected = calendar.find((month) => monthKey(month) === selection)
  const surface = useResolvedSecondaryWidgetSurface()

  return (
    <View style={styles.details}>
      {today ? (
        <StatsReadout
          title="Today"
          showTodayDot
          stats={today}
          testID="profile-today-stats"
          style={[surface, styles.box]}
          onOpenRecordRide={onOpenRecordRide}
        />
      ) : null}
      {total ? (
        <StatsReadout
          title="All time"
          stats={total}
          testID="profile-all-time-stats"
          style={[surface, styles.box]}
          onOpenRecordRide={onOpenRecordRide}
        />
      ) : null}
      <View style={[surface, styles.box, styles.monthlyBox]}>
        <MonthlyDistanceChart
          months={calendar}
          selected={selected ? monthKey(selected) : null}
          loading={loading}
          onSelect={(key) => setSelection((current) => (current === key ? null : key))}
        />
        {selected ? (
          <StatsReadout
            title={formatMonthLabel(selected)}
            stats={selected.stats}
            testID="profile-selected-month-stats"
            onOpenRecordRide={onOpenRecordRide}
          />
        ) : null}
      </View>
    </View>
  )
}

function StatsReadout({
  title,
  showTodayDot = false,
  stats,
  testID,
  style,
  onOpenRecordRide,
}: {
  title: string
  showTodayDot?: boolean
  stats: RiderStats
  testID: string
  style?: StyleProp<ViewStyle>
  onOpenRecordRide?: OpenRecordRide
}) {
  const items = useProfileStatItems(stats, undefined, onOpenRecordRide)
  return (
    <View testID={testID} style={style}>
      <View style={styles.titleRow}>
        {showTodayDot ? <View style={styles.todayDot} /> : null}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      <ProfileStatsGrid items={items} columns={3} />
    </View>
  )
}

function monthKey({ year, month }: ProfileStatsMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

const EMPTY_MONTH_STATS = { ...EMPTY_PROFILE_STATS, distanceM: 0 }

function fillCalendarMonths(months: readonly MonthStats[], now = new Date()): MonthStats[] {
  if (!months.length) return []

  const indexOf = ({ year, month }: ProfileStatsMonth) => year * 12 + month - 1
  const byMonth = new Map(months.map((month) => [indexOf(month), month]))
  const current = now.getFullYear() * 12 + now.getMonth()
  const last = Math.max(current, ...byMonth.keys())
  const first = Math.min(...byMonth.keys())

  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset
    return (
      byMonth.get(index) ?? {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
        stats: EMPTY_MONTH_STATS,
      }
    )
  })
}

function MonthlyDistanceChart({
  months,
  selected,
  loading,
  onSelect,
}: {
  months: readonly MonthStats[]
  selected: string | null
  loading: boolean
  onSelect: (key: string) => void
}) {
  const { sky } = useResolvedAccentColors()
  const { border } = useResolvedNeutralColors()
  const { distanceUnit } = useUserPreferences()
  const unit = rideDistanceUnit(distanceUnit)
  const scroll = useRef<ScrollView>(null)
  const positioned = useRef(false)
  const maxDistance = Math.max(1, ...months.map(({ stats }) => stats.distanceM ?? 0))
  const years = new Map<number, MonthStats[]>()
  for (const month of months) {
    const year = years.get(month.year)
    if (year) year.push(month)
    else years.set(month.year, [month])
  }

  return (
    <View testID="profile-monthly-chart" style={styles.chart}>
      <View style={styles.chartHeader}>
        <Text accessibilityRole="header" style={styles.title}>
          Monthly stats
        </Text>
        {months.length ? <Text style={styles.month}>Distance · {unit}</Text> : null}
      </View>
      {months.length ? (
        <ScrollView
          horizontal
          ref={scroll}
          directionalLockEnabled
          contentContainerStyle={styles.years}
          onContentSizeChange={() => {
            if (positioned.current) return
            positioned.current = true
            scroll.current?.scrollToEnd({ animated: false })
          }}
        >
          {Array.from(years, ([year, entries], index) => (
            <View
              key={year}
              style={[
                styles.year,
                index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: border },
              ]}
            >
              <View style={styles.bars}>
                {entries.map((entry) => {
                  const key = monthKey(entry)
                  const active = selected === key
                  const distance = entry.stats.distanceM
                  const value =
                    distance == null
                      ? DASH
                      : chartDistance.format(rideDistanceFromMeters(distance, distanceUnit))
                  const month = new Date(entry.year, entry.month - 1, 1).toLocaleDateString(
                    undefined,
                    {
                      month: 'short',
                    },
                  )
                  return (
                    <Pressable
                      key={key}
                      testID={`profile-month-${key}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${formatMonthLabel(entry)}, ${distance == null ? 'distance unavailable' : `${value} ${unit}`}`}
                      onPress={() => onSelect(key)}
                      style={[styles.column, entry.month === 1 && styles.january]}
                    >
                      <Text style={[styles.barValue, active && { color: sky.text }]}>{value}</Text>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: Math.max(3, (76 * (distance ?? 0)) / maxDistance),
                            borderColor: sky.color,
                            backgroundColor: active ? sky.color : sky.bg,
                          },
                        ]}
                      />
                      <Text numberOfLines={1} style={[styles.month, active && { color: sky.text }]}>
                        {month}
                      </Text>
                      {entry.month === 1 ? (
                        <Text numberOfLines={1} style={styles.yearLabel}>
                          {year}
                        </Text>
                      ) : null}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.month}>
          {loading ? 'Loading monthly stats…' : 'No monthly stats available.'}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.palette.green.color },
  details: { gap: 12 },
  box: { padding: 16 },
  monthlyBox: { gap: 12 },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.neutral.textSecondary,
  },
  chart: { gap: 8 },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  years: { flexGrow: 1, gap: 10, paddingBottom: 5 },
  year: { flexGrow: 1, paddingHorizontal: 4 },
  january: { minWidth: 62, paddingLeft: 16 },
  yearLabel: {
    position: 'absolute',
    left: -10,
    bottom: 15,
    color: theme.neutral.textSecondary,
    width: 40,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    transform: [{ rotate: '90deg' }],
  },
  bars: { flexGrow: 1, flexDirection: 'row', minHeight: 118, gap: 4 },
  column: { flex: 1, minWidth: 46, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '78%', maxWidth: 48, borderWidth: 1, borderRadius: 4 },
  barValue: {
    color: theme.neutral.textPrimary,
    fontVariant: ['tabular-nums'],
    fontSize: 10,
    fontWeight: '700',
  },
  month: { color: theme.neutral.textSecondary, fontSize: 11 },
})
