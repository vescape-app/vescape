import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { UserCircleIcon, UserMinusIcon } from 'phosphor-react-native'
import { getRider, type RiderProfile, type RiderDetail, type RiderStats } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { theme } from '@/constants/theme'
import { formatMonthLabel } from '@/modules/profile/lib/profileStats'
import { useProfileStatItems } from '@/modules/profile/hooks/useProfileStatItems'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { FriendAction } from '@/modules/profile/components/FriendAction'
import { friendStatus } from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

/**
 * Another rider's public profile: who they are, the friend action that fits, and `children` for
 * sections the host adds (show on map; their public rides later).
 */
export function RiderProfileCard({
  rider: seen,
  children,
}: {
  /** What the opener knew; a map pin carries no nationality, so the server's copy replaces it. */
  rider: RiderProfile
  children?: ReactNode
}) {
  const [fetched, setFetched] = useState<RiderDetail | null>(null)
  useEffect(() => {
    let live = true
    // intentional-suppression: the card keeps what the opener knew when the fetch fails
    getRider(seen.accountId).then(
      (profile) => live && setFetched(profile),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [seen.accountId])
  const rider = fetched?.accountId === seen.accountId ? fetched : seen
  const stats = fetched?.accountId === seen.accountId ? fetched.stats : null
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthly = stats?.months.find((month) => month.month === monthKey)
  const friend = useFriendsStore((s) =>
    s.lists.friends.find((row) => row.accountId === rider.accountId),
  )
  const error = useFriendsStore((s) => s.error)
  const nowMs = useMinuteNow(friend !== undefined)
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <View style={styles.card} testID="rider-profile">
      <View style={styles.identity}>
        <UserCircleIcon
          size={46}
          color={friend?.ridingNow ? theme.palette.green.color : theme.neutral.textSecondary}
          weight="thin"
        />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.nick}>
            {rider.nick}
          </Text>
          <Text style={styles.caption}>
            {[rider.nationality, friend ? friendStatus(friend, nowMs) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <FriendAction accountId={rider.accountId} nick={rider.nick} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {monthly ? (
        <RiderStatsReadout
          label={formatMonthLabel({ year: now.getFullYear(), month: now.getMonth() + 1 })}
          stats={monthly}
        />
      ) : null}
      {stats?.total ? <RiderStatsReadout label="Total" stats={stats.total} /> : null}
      {children}
      {friend ? (
        <Button
          label="Remove friend"
          icon={UserMinusIcon}
          size="sm"
          variant="secondary"
          style={styles.remove}
          onPress={() => setConfirmRemove(true)}
        />
      ) : null}
      <ConfirmModal
        visible={confirmRemove}
        title={`Remove ${rider.nick}?`}
        message="They will not be told. You can send a new request later."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          setConfirmRemove(false)
          await useFriendsStore.getState().remove(rider.accountId)
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  )
}

function RiderStatsReadout({ label, stats }: { label: string; stats: RiderStats }) {
  const rows = useProfileStatItems(stats)
  return (
    <View>
      <Text>{label}</Text>
      {rows.map(({ key, label: name, value }) => (
        <Text key={key}>
          {name}: {value}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  nick: { color: theme.neutral.textPrimary, fontSize: 22, fontWeight: '700' },
  caption: { color: theme.neutral.textSecondary, fontSize: 12 },
  error: { color: theme.status.error.text, fontSize: 12 },
  remove: { alignSelf: 'flex-start' },
})
