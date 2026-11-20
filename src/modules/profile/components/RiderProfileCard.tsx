import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { BroadcastIcon, ChartBarIcon, UserCircleIcon, UserMinusIcon } from 'phosphor-react-native'
import { getRider, type RiderDetail, type RiderProfile } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { theme } from '@/constants/theme'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { FriendAction } from '@/modules/profile/components/FriendAction'
import { ProfileStatsDetails } from '@/modules/profile/components/ProfileStatsDetails'
import { friendStatus } from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

export function RiderProfileCard({
  accountId,
  seen,
  status,
  children,
  afterStats,
}: {
  accountId: string
  seen: Pick<RiderProfile, 'nick' | 'nationality'> | null
  status?: string
  children?: ReactNode
  afterStats?: ReactNode
}) {
  const neutral = useResolvedNeutralColors()
  const [result, setResult] = useState<{ detail: RiderDetail | null; failed: boolean } | null>(null)
  useEffect(() => {
    let live = true
    getRider(accountId).then(
      (detail) => {
        if (live) setResult({ detail, failed: false })
      },
      () => {
        if (live) setResult({ detail: null, failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [accountId])

  const rider = result?.detail ?? seen
  const stats = result?.detail?.stats
  const friend = useFriendsStore((s) => s.lists.friends.find((row) => row.accountId === accountId))
  const error = useFriendsStore((s) => s.error)
  const nowMs = useMinuteNow(friend !== undefined)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const caption = [rider?.nationality, status ?? (friend ? friendStatus(friend, nowMs) : null)]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={styles.card} testID="rider-profile">
      <View style={styles.identity}>
        <UserCircleIcon size={46} color={neutral.textSecondary} weight="thin" />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.nick}>
            {rider?.nick ??
              (result?.failed
                ? 'Rider profile unavailable'
                : result
                  ? 'Rider not found'
                  : 'Loading rider…')}
          </Text>
          {caption ? (
            <View style={styles.status}>
              {status || friend?.ridingNow ? (
                <BroadcastIcon size={14} color={theme.palette.green.color} />
              ) : null}
              <Text style={styles.caption}>{caption}</Text>
            </View>
          ) : null}
        </View>
        {friend ? (
          <Button
            label="Remove friend"
            icon={UserMinusIcon}
            size="sm"
            variant="secondary"
            onPress={() => setConfirmRemove(true)}
          />
        ) : rider ? (
          <FriendAction accountId={accountId} nick={rider.nick} />
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {children}
      <PublicRiderStats stats={stats} loading={!result} failed={result?.failed} />
      {afterStats}
      {friend ? (
        <ConfirmModal
          visible={confirmRemove}
          title={`Remove ${friend.nick}?`}
          message="They will not be told. You can send a new request later."
          confirmLabel="Remove"
          destructive
          onConfirm={async () => {
            setConfirmRemove(false)
            await useFriendsStore.getState().remove(accountId)
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}
    </View>
  )
}

function PublicRiderStats({
  stats,
  loading,
  failed,
}: {
  stats?: RiderDetail['stats']
  loading: boolean
  failed?: boolean
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Riding stats" icon={ChartBarIcon} color={theme.palette.purple.color} />
      {failed ? (
        <Text style={styles.error}>Couldn’t load ride stats.</Text>
      ) : !loading && !stats?.total && !stats?.months.length ? (
        <Text style={styles.caption}>No public ride stats available.</Text>
      ) : null}
      <ProfileStatsDetails
        total={stats?.total ?? null}
        months={
          stats?.months.map((entry) => {
            const [year, month] = entry.month.split('-').map(Number)
            return { year, month, stats: entry }
          }) ?? []
        }
        loading={loading}
        unavailable={failed}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  section: { gap: 10 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1, minWidth: 0 },
  nick: { color: theme.neutral.textPrimary, fontSize: 20, fontWeight: '700' },
  caption: { color: theme.neutral.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
  error: { color: theme.status.error.text, fontSize: 12 },
})
