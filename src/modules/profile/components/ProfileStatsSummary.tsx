import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ChartLineUpIcon, WarningCircleIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { SegmentedToggle, type SegmentedOption } from '@/components/controls/SegmentedToggle'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import {
  useProfileStatItems,
  type OpenRecordRide,
} from '@/modules/profile/hooks/useProfileStatItems'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { formatMonthLabel } from '@/modules/profile/lib/profileStats'

type Scope = 'today' | 'total' | 'month'

interface ProfileStatsSummaryProps {
  /** Load and refresh while the containing drawer or screen is visible. */
  active?: boolean
  /** Action pinned opposite the scope switch, e.g. a link into the full stats screen. */
  action?: ReactNode
  /** Tapping Top speed or Longest ride opens the ride that set it. */
  onOpenRecordRide?: OpenRecordRide
}

/**
 * The rider's headline totals: four figures, switchable between all time and the current month.
 * After a ride today, Today replaces the month and opens first; both labels do not fit together.
 * The full breakdown lives on the Profile Stats screen; this is the glance version.
 */
export function ProfileStatsSummary({
  active = true,
  action,
  onOpenRecordRide,
}: ProfileStatsSummaryProps) {
  const { total, monthly, today, selectedMonth, loading, error, empty } = useProfileStats(active)
  const surface = useResolvedSecondaryWidgetSurface()
  const accent = useResolvedAccentColors()
  const [picked, setPicked] = useState<Scope | null>(null)
  const options: SegmentedOption<Scope>[] =
    today.rideCount > 0
      ? [
          { value: 'today', label: 'Today', dot: theme.palette.green.color },
          { value: 'total', label: 'All time' },
        ]
      : [
          { value: 'total', label: 'All time' },
          { value: 'month', label: formatMonthLabel(selectedMonth) },
        ]
  const scope = options.find((option) => option.value === picked)?.value ?? options[0].value
  const stats = { today, total, month: monthly }[scope]
  // Today is a different view from the rider's lifetime profile; the card says so at a glance.
  const todayStyle = scope === 'today' && { borderColor: accent.sky.border }
  const items = useProfileStatItems(
    stats,
    ['topSpeed', 'distance', 'longestRide', 'rides'],
    onOpenRecordRide,
  )

  return (
    <View
      style={[surface, styles.card, todayStyle && [styles.todayCard, todayStyle]]}
      testID="profile-stats-summary"
      accessibilityState={{ busy: loading }}
    >
      <View style={styles.head}>
        <SegmentedToggle<Scope>
          options={options}
          value={scope}
          onChange={setPicked}
          variant="secondary"
        />
        {action}
      </View>
      <View style={styles.body}>
        {!loading && error ? (
          <Placeholder
            icon={WarningCircleIcon}
            description="Could not load riding totals. Restart the app to try again"
            style={styles.empty}
          />
        ) : !loading && empty ? (
          <Placeholder
            icon={ChartLineUpIcon}
            description="Record a ride and your totals appear here"
            style={styles.empty}
          />
        ) : (
          <ProfileStatsGrid items={items} emphasis columns={4} />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: 12,
  },
  todayCard: {
    borderWidth: 1.5,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  empty: {
    paddingVertical: 12,
  },
  body: {
    minHeight: 72,
    justifyContent: 'center',
  },
})
