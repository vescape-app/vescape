import { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { MapTrifoldIcon } from 'phosphor-react-native'
import type { FriendRide } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import { formatClock } from '@/helpers/time'
import { useTimeFormat } from '@/hooks/useTimeFormat'
import { useFriendRidesStore } from '@/modules/group-ride/store/friendRidesStore'

/**
 * A Friend's public rides on their profile; tapping one opens it on the map. Only for Friends:
 * the server refuses anyone else, so the host renders this only when the rider is one.
 */
export function FriendRides({ accountId, onOpen }: { accountId: string; onOpen: () => void }) {
  const rides = useFriendRidesStore((s) => (s.accountId === accountId ? s.rides : null))
  const loading = useFriendRidesStore((s) => s.loading)
  const failed = useFriendRidesStore((s) => s.failed)
  const shownKey = useFriendRidesStore((s) => s.track?.key ?? null)
  const toggleTrack = useFriendRidesStore((s) => s.toggleTrack)
  useEffect(() => {
    void useFriendRidesStore.getState().load(accountId)
  }, [accountId])

  return (
    <View style={styles.section} testID="friend-rides">
      <Text style={styles.title}>Public rides</Text>
      {loading || rides === null ? (
        <ActivityIndicator color={theme.neutral.textSecondary} />
      ) : failed ? (
        <Text style={styles.notice}>Could not load rides.</Text>
      ) : rides.length === 0 ? (
        <Text style={styles.notice}>No public rides yet.</Text>
      ) : (
        rides.map((ride) => {
          const shown = shownKey === `${accountId}-${ride.startedAt}`
          return (
            <PublicRideRow
              key={ride.startedAt}
              ride={ride}
              shown={shown}
              onPress={() => {
                void toggleTrack(accountId, ride)
                if (!shown) onOpen()
              }}
            />
          )
        })
      )}
    </View>
  )
}

/** One public ride: day, time range and length. `shown` marks the ride open on the map. */
export function PublicRideRow({
  ride,
  shown = false,
  onPress,
}: {
  ride: FriendRide
  shown?: boolean
  onPress?: () => void
}) {
  const timeFormat = useTimeFormat()
  const startMs = Date.parse(ride.startedAt)
  const endMs = Date.parse(ride.endedAt)
  const minutes = Math.max(1, Math.round((endMs - startMs) / 60_000))
  const day = new Date(startMs).toLocaleDateString()
  const time = `${formatClock(startMs, false, timeFormat)}–${formatClock(endMs, false, timeFormat)}`
  return (
    <Pressable
      style={[styles.row, shown && styles.rowShown]}
      onPress={onPress}
      disabled={!onPress}
      android_ripple={interaction.ripple}
      accessibilityRole="button"
      accessibilityState={{ selected: shown }}
      accessibilityLabel={`Ride ${day} ${time}, ${minutes} min${shown ? ', on the map' : ''}`}
    >
      <MapTrifoldIcon
        size={18}
        color={shown ? theme.neutral.textPrimary : theme.neutral.textSecondary}
        weight={shown ? 'fill' : 'regular'}
      />
      <View style={styles.flex}>
        <Text style={styles.day}>{day}</Text>
        <Text style={styles.notice}>{time}</Text>
      </View>
      <Text style={styles.notice}>{minutes} min</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  title: { color: theme.neutral.textPrimary, fontSize: 15, fontWeight: '700' },
  notice: { color: theme.neutral.textSecondary, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rowShown: { backgroundColor: theme.control.background },
  flex: { flex: 1, minWidth: 0 },
  day: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
})
