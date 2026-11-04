import { router, Stack, useLocalSearchParams } from 'expo-router'
import { ClockCounterClockwiseIcon, WarningCircleIcon } from 'phosphor-react-native'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RideDay } from 'vescape-core'

import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { theme } from '@/constants/theme'
import { HistoryRideRow } from '@/modules/history/components/HistoryRideRow'
import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { formatRideTime } from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow } from '@/modules/history/lib/sessions'
import { useRideDaySessions } from '@/modules/history/hooks/useRideDaySessions'
import { formatRideDay } from '@/modules/history/lib/rideDay'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { useDayStats } from '@/modules/profile/hooks/useDayStats'
import { useProfileStatItems } from '@/modules/profile/hooks/useProfileStatItems'
import { parseRideDay, rideHref } from '@/navigation/links'
import { openRecordRide } from '@/screens/profileStats/openRecordRide'

/** One day of riding: its totals, then the rides, each opening on the main screen. */
export function RideDayScreen() {
  const day = parseRideDay(useLocalSearchParams())
  if (!day) {
    return (
      <View style={styles.container}>
        <Placeholder
          icon={WarningCircleIcon}
          description="Day not found"
          style={styles.placeholder}
        />
      </View>
    )
  }
  return <RideDayContent day={day} />
}

function RideDayContent({ day }: { day: RideDay }) {
  const stats = useDayStats(day)
  const rides = useRideDaySessions(day)
  const { formatRideDetails } = useRideFormat()
  const insets = useSafeAreaInsets()
  const items = useProfileStatItems(stats.value, undefined, openRecordRide)

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      testID="ride-day-screen"
    >
      <Stack.Screen options={{ title: formatRideDay(day) }} />
      {stats.loading ? (
        <ActivityIndicator size="small" color={theme.palette.sky.color} style={styles.loading} />
      ) : stats.error ? (
        <Placeholder
          icon={WarningCircleIcon}
          description="Could not load this day's stats. Restart the app to try again"
          style={styles.placeholder}
        />
      ) : (
        <ProfileStatsGrid items={items} />
      )}

      <SectionHeader
        icon={ClockCounterClockwiseIcon}
        color={theme.palette.purple.color}
        title={rides.value.length ? `Rides · ${rides.value.length}` : 'Rides'}
      />
      {rides.loading ? (
        <ActivityIndicator size="small" color={theme.palette.purple.color} style={styles.loading} />
      ) : rides.error ? (
        <Placeholder
          icon={WarningCircleIcon}
          title="Could not load rides"
          description="Restart the app to try again"
          style={styles.placeholder}
        />
      ) : rides.value.length === 0 ? (
        <Placeholder
          icon={ClockCounterClockwiseIcon}
          description="No rides recorded this day"
          style={styles.placeholder}
        />
      ) : (
        <View style={styles.rides}>
          {rides.value.map((session, index) => {
            const window = rideMovingWindow(session) ?? {
              startMs: session.startAtMs,
              endMs: session.endAtMs,
            }
            return (
              <HistoryRideRow
                key={session.id}
                testID={index === 0 ? 'ride-day-first-ride' : undefined}
                title={formatRideTime(
                  window.startMs,
                  window.endMs,
                  isLiveRide(session, Date.now()),
                )}
                subtitle={formatRideDetails(
                  window.endMs - window.startMs,
                  session.distanceM,
                  session.boardName,
                )}
                routePoints={session.routePoints}
                weather={session.weather}
                onPress={() => router.dismissTo(rideHref({ rideId: session.id, focus: null }))}
              />
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  rides: {
    gap: 8,
  },
  loading: {
    padding: 18,
  },
  placeholder: {
    paddingVertical: 24,
  },
})
