import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { ClockIcon } from 'phosphor-react-native'
import type { FriendRide } from 'vescape-core'

import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { formatClock } from '@/helpers/time'
import { useTimeFormat } from '@/hooks/useTimeFormat'
import { useFriendRidesStore } from '@/modules/group-ride/store/friendRidesStore'

/**
 * A rider's public rides (for Friends or the signed-in rider's own profile). The server refuses
 * non-friends, so the host renders this only for Friends or the rider themselves.
 */
export function FriendRides({ accountId }: { accountId: string }) {
  const rides = useFriendRidesStore((s) => (s.accountId === accountId ? s.rides : null))
  const loading = useFriendRidesStore((s) => s.loading)
  const failed = useFriendRidesStore((s) => s.failed)
  const surface = useResolvedSecondaryWidgetSurface()
  useEffect(() => {
    void useFriendRidesStore.getState().load(accountId)
  }, [accountId])

  return (
    <View style={styles.section} testID="friend-rides">
      <SectionHeader title="Public rides" icon={ClockIcon} color={theme.palette.green.color} />
      <View style={[surface, styles.box]}>
        {loading || rides === null ? (
          <ActivityIndicator color={theme.neutral.textSecondary} />
        ) : failed ? (
          <Text style={styles.notice}>Could not load rides.</Text>
        ) : rides.length === 0 ? (
          <Text style={styles.notice}>No public rides yet.</Text>
        ) : (
          <View style={styles.list}>
            {rides.map((ride) => (
              <PublicRideRow key={ride.startedAt} ride={ride} />
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

/** One public ride: day, time range and length. */
export function PublicRideRow({ ride }: { ride: FriendRide }) {
  const timeFormat = useTimeFormat()
  const startMs = Date.parse(ride.startedAt)
  const endMs = Date.parse(ride.endedAt)
  const minutes = Math.max(1, Math.round((endMs - startMs) / 60_000))
  const day = new Date(startMs).toLocaleDateString()
  const time = `${formatClock(startMs, false, timeFormat)}–${formatClock(endMs, false, timeFormat)}`
  return (
    <View style={styles.row} accessible accessibilityLabel={`Ride ${day} ${time}, ${minutes} min`}>
      <View style={styles.flex}>
        <Text style={styles.day}>{day}</Text>
        <Text style={styles.notice}>{time}</Text>
      </View>
      <Text style={styles.notice}>{minutes} min</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  box: { padding: 16 },
  list: { gap: 8 },
  notice: { color: theme.neutral.textSecondary, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  flex: { flex: 1, minWidth: 0 },
  day: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
})
