import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ChartLineUpIcon, WarningCircleIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { widgetSurface } from '@/components/widgets/widgetSurface'
import { pickProfileStatItems } from '@/modules/profile/components/profileStatItems'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { formatMonthLabel } from '@/modules/profile/lib/profileStats'

type Scope = 'total' | 'month'

interface ProfileStatsSummaryProps {
  /** Load and refresh while the containing drawer or screen is visible. */
  active?: boolean
  /** Action pinned opposite the scope switch, e.g. a link into the full stats screen. */
  action?: ReactNode
}

/**
 * The rider's headline totals: four figures, switchable between all time and the current month.
 * The full breakdown lives on the Profile Stats screen; this is the glance version.
 */
export function ProfileStatsSummary({ active = true, action }: ProfileStatsSummaryProps) {
  const { total, monthly, selectedMonth, loading, error, empty, refresh } = useProfileStats(active)
  const [scope, setScope] = useState<Scope>('total')
  const stats = scope === 'total' ? total : monthly

  return (
    <View style={styles.card} testID="profile-stats-summary" accessibilityState={{ busy: loading }}>
      <View style={styles.head}>
        <SegmentedToggle<Scope>
          options={[
            { value: 'total', label: 'All time' },
            { value: 'month', label: formatMonthLabel(selectedMonth) },
          ]}
          value={scope}
          onChange={setScope}
        />
        {action}
      </View>
      <View style={styles.body}>
        {!loading && error ? (
          <Placeholder
            icon={WarningCircleIcon}
            description="Could not load riding totals"
            action={<Button label="Retry" size="sm" variant="secondary" onPress={refresh} />}
            style={styles.empty}
          />
        ) : !loading && empty ? (
          <Placeholder
            icon={ChartLineUpIcon}
            description="Your riding totals appear once a ride is recorded"
            style={styles.empty}
          />
        ) : (
          <ProfileStatsGrid
            items={pickProfileStatItems(stats, ['distance', 'rides', 'topSpeed', 'longestRide'])}
            emphasis
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    ...widgetSurface,
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
    minHeight: 134,
    justifyContent: 'center',
  },
})
