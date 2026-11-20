import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ChartBarIcon, UserCircleIcon, UserMinusIcon } from 'phosphor-react-native'
import { getRider, type RiderDetail, type RiderProfile } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { AccountPill } from '@/modules/profile/components/AccountPill'
import { FriendAction } from '@/modules/profile/components/FriendAction'
import { ProfileStatsDetails } from '@/modules/profile/components/ProfileStatsDetails'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useProfileStatItems } from '@/modules/profile/hooks/useProfileStatItems'
import { EMPTY_PROFILE_STATS } from '@/modules/profile/hooks/useProfileStats'
import { friendStatus } from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

export function RiderProfileCard({
  accountId,
  seen,
  children,
  afterStats,
}: {
  accountId: string
  seen: Pick<RiderProfile, 'nick' | 'nationality'> | null
  children?: ReactNode
  afterStats?: ReactNode
}) {
  const neutral = useResolvedNeutralColors()
  const signedIn = useDeviceAccountReady()
  const [loaded, setLoaded] = useState<{
    accountId: string
    detail: RiderDetail | null
    failed: boolean
  } | null>(null)
  useEffect(() => {
    if (!signedIn) return
    let live = true
    getRider(accountId).then(
      (detail) => {
        if (live) setLoaded({ accountId, detail, failed: false })
      },
      () => {
        if (live) setLoaded({ accountId, detail: null, failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [accountId, signedIn])

  const result = signedIn && loaded?.accountId === accountId ? loaded : null

  const rider = result?.detail ?? seen
  const stats = result?.detail?.stats
  const friend = useFriendsStore((s) => s.lists.friends.find((row) => row.accountId === accountId))
  const error = useFriendsStore((s) => s.error)
  const nowMs = useMinuteNow(friend !== undefined && !friend.ridingNow)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const caption = [
    rider?.nationality,
    friend && !friend.ridingNow ? friendStatus(friend, nowMs) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={styles.card} testID="rider-profile">
      <View style={styles.identity}>
        <UserCircleIcon size={46} color={neutral.textSecondary} weight="thin" />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.nick}>
            {rider?.nick ??
              (!signedIn
                ? 'Rider'
                : result?.failed
                  ? 'Rider profile unavailable'
                  : result
                    ? 'Rider not found'
                    : 'Loading rider…')}
          </Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
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
      <PublicRiderStats
        signedIn={signedIn}
        stats={stats}
        loading={signedIn && !result}
        failed={result?.failed}
      />
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
  signedIn,
  stats,
  loading,
  failed,
}: {
  signedIn: boolean
  stats?: RiderDetail['stats']
  loading: boolean
  failed?: boolean
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Riding stats" icon={ChartBarIcon} color={theme.palette.purple.color} />
      {signedIn ? (
        <>
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
        </>
      ) : (
        <SignedOutRiderStats />
      )}
    </View>
  )
}

function SignedOutRiderStats() {
  const surface = useResolvedSecondaryWidgetSurface()
  const items = useProfileStatItems(EMPTY_PROFILE_STATS).map((item) => ({ ...item, value: DASH }))

  return (
    <View>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[surface, styles.signedOutBox, styles.covered]}
      >
        <ProfileStatsGrid items={items} columns={3} />
      </View>
      <View style={styles.overlay}>
        <AccountPill signInSize="lg" />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  section: { gap: 10 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  nick: { color: theme.neutral.textPrimary, fontSize: 20, fontWeight: '700' },
  caption: { color: theme.neutral.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
  error: { color: theme.status.error.text, fontSize: 12 },
  signedOutBox: { padding: 16 },
  covered: { opacity: 0.25 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
})
