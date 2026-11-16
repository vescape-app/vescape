import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ChartLineUpIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import {
  useProfileStatItems,
  type OpenRecordRide,
} from '@/modules/profile/hooks/useProfileStatItems'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { ProfileStatsDetails } from '@/modules/profile/components/ProfileStatsDetails'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'

interface RideStatsSectionProps {
  /** Tapping Top speed or Longest ride opens the ride that set it. */
  onOpenRecordRide?: OpenRecordRide
}

export function RideStatsSection({ onOpenRecordRide }: RideStatsSectionProps) {
  const { total, today, monthStats, loading, error, empty } = useProfileStats(true, true)
  const accent = useResolvedAccentColors()
  const surface = useResolvedSecondaryWidgetSurface()
  const todayItems = useProfileStatItems(today, undefined, onOpenRecordRide)

  return (
    <View testID="profile-stats-section" style={styles.section}>
      {error && !loading ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Could not load profile stats</Text>
          <Text style={styles.errorText}>Restart the app to try again</Text>
        </View>
      ) : empty && !loading ? (
        <Placeholder
          icon={ChartLineUpIcon}
          title="No riding stats yet"
          description="Record a ride and your totals appear here"
          style={styles.empty}
        />
      ) : null}

      <ProfileStatsDetails
        total={loading || empty || error ? null : total}
        months={monthStats}
        loading={loading}
        unavailable={Boolean(error)}
        onOpenRecordRide={onOpenRecordRide}
      />

      {today.rideCount > 0 ? (
        <View testID="profile-today-stats" style={[surface, styles.todayCard]}>
          <View style={styles.todayHeader}>
            <View style={[styles.todayDot, { backgroundColor: accent.green.color }]} />
            <Text style={[styles.sectionTitle, styles.todayTitle]}>Today</Text>
          </View>
          <ProfileStatsGrid items={todayItems} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={theme.palette.sky.color} />
        </View>
      ) : null}
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
  todayCard: {
    padding: 12,
    gap: 4,
  },
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 4,
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  todayTitle: {
    marginLeft: 0,
    marginTop: 0,
  },
  empty: {
    minHeight: 260,
    paddingVertical: 32,
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
})
