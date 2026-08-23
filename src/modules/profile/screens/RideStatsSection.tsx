import { useCallback, useMemo } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ChartLineUpIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { profileStatItems } from '@/modules/profile/components/profileStatItems'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { formatMonthLabel, getAdjacentMonths } from '@/modules/profile/lib/profileStats'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'
import { Select, type SelectOption } from '@/components/forms/Select'
import { theme } from '@/constants/theme'

export function RideStatsSection() {
  const {
    total,
    monthly,
    months,
    selectedMonth,
    loading,
    monthLoading,
    error,
    empty,
    refresh,
    selectMonth,
  } = useProfileStats()
  const totalItems = useMemo(() => profileStatItems(total), [total])
  const monthItems = useMemo(() => profileStatItems(monthly), [monthly])
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
      if (found) void selectMonth(found)
    },
    [months, selectMonth],
  )

  return (
    <View testID="profile-stats-section" style={styles.section}>
      {empty && !loading ? (
        <Placeholder
          icon={ChartLineUpIcon}
          title="No riding stats yet"
          description="Record a ride and your totals appear here"
          style={styles.empty}
        />
      ) : (
        <>
          <Text style={styles.sectionTitle}>All time</Text>
          <ProfileStatsGrid items={totalItems} />

          <View style={styles.monthHeader}>
            <Text style={styles.sectionTitle}>Monthly</Text>
            {monthLoading ? (
              <ActivityIndicator
                testID="profile-month-loading"
                size="small"
                color={theme.palette.sky.color}
              />
            ) : null}
          </View>
          <PrevNextSelector
            label={formatMonthLabel(selectedMonth)}
            previousDisabled={!adjacent.previous}
            nextDisabled={!adjacent.next}
            onPrevious={() => adjacent.previous && void selectMonth(adjacent.previous)}
            onNext={() => adjacent.next && void selectMonth(adjacent.next)}
            accessibilityLabel="Select profile month"
            style={styles.monthNav}
            selectControl={
              <Select
                options={monthOptions}
                value={selectedMonthValue}
                onChange={handleMonthSelect}
                placeholder="Select month"
                testID="profile-month-select"
                style={styles.monthSelect}
              />
            }
          />
          <ProfileStatsGrid items={monthItems} />
        </>
      )}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={theme.palette.sky.color} />
        </View>
      ) : null}

      {error ? (
        <Pressable style={styles.errorCard} onPress={() => void refresh()}>
          <Text style={styles.errorTitle}>Could not load profile stats</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
    marginTop: 4,
  },
  empty: {
    minHeight: 260,
    paddingVertical: 32,
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
    color: theme.palette.slate.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
})
