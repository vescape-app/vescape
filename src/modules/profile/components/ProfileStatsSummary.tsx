import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ChartLineUpIcon, WarningCircleIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { SegmentedToggle, type SegmentedOption } from '@/components/controls/SegmentedToggle'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import {
  useProfileStatItems,
  type OpenRecordRide,
  type ProfileStatKey,
} from '@/modules/profile/hooks/useProfileStatItems'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { formatMonthLabel } from '@/modules/profile/lib/profileStats'

type Scope = 'today' | 'total' | 'month'

const SUMMARY_KEYS: ProfileStatKey[] = ['topSpeed', 'distance', 'longestRide', 'rides']
const TODAY_KEYS: ProfileStatKey[] = [
  'topSpeed',
  'distance',
  'rideTime',
  'avgSpeed',
  'used',
  'regen',
]

interface ProfileStatsSummaryProps {
  active?: boolean
  action?: ReactNode
  onOpenRecordRide?: OpenRecordRide
}

export function ProfileStatsSummary({
  active = true,
  action,
  onOpenRecordRide,
}: ProfileStatsSummaryProps) {
  const { total, monthly, today, selectedMonth, loading, error, empty } = useProfileStats(active)
  const surface = useResolvedSecondaryWidgetSurface()
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
  const items = useProfileStatItems(
    stats,
    scope === 'today' ? TODAY_KEYS : SUMMARY_KEYS,
    onOpenRecordRide,
  )

  return (
    <View
      style={[surface, styles.card]}
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
          <ProfileStatsGrid items={items} emphasis columns={scope === 'today' ? 3 : 4} />
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
