import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ChartLineUpIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import type { OpenRecordRide } from '@/modules/profile/hooks/useProfileStatItems'
import { useProfileStats } from '@/modules/profile/hooks/useProfileStats'
import { ProfileStatsDetails } from '@/modules/profile/components/ProfileStatsDetails'
import { theme } from '@/constants/theme'

interface RideStatsSectionProps {
  /** Tapping Top speed or Longest ride opens the ride that set it. */
  onOpenRecordRide?: OpenRecordRide
}

export function RideStatsSection({ onOpenRecordRide }: RideStatsSectionProps) {
  const { total, today, monthStats, loading, error, empty } = useProfileStats(true, true)

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
        today={today.rideCount > 0 ? today : undefined}
        total={loading || empty || error ? null : total}
        months={monthStats}
        loading={loading}
        unavailable={Boolean(error)}
        onOpenRecordRide={onOpenRecordRide}
      />

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
