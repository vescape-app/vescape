import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SignInIcon } from 'phosphor-react-native'
import { searchRiders, type RiderProfile } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { SearchInput } from '@/components/forms/SearchInput'
import { theme } from '@/constants/theme'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { FriendAction } from '@/modules/profile/components/FriendAction'
import { FriendRow } from '@/modules/profile/components/FriendRow'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import {
  friendStatus,
  friendsErrorMessage,
  riderSearchPrefix,
  sortFriends,
} from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

const SEARCH_DEBOUNCE_MS = 300

/**
 * Friends in the Social drawer: search riders by nick, answer requests, and see who is riding now.
 * Signed out, it only offers sign-in.
 */
export function FriendsCard({
  onPressRider,
  onSignIn,
}: {
  onPressRider: (rider: RiderProfile) => void
  onSignIn: () => void
}) {
  const signedIn = useDeviceAccountReady()
  const [query, setQuery] = useState('')
  const prefix = riderSearchPrefix(query)

  if (!signedIn) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Friends</Text>
        <Text style={styles.notice}>Sign in to find riders and see when friends ride.</Text>
        <Button
          label="Sign in to add friends"
          variant="groupRide"
          icon={SignInIcon}
          onPress={onSignIn}
        />
      </View>
    )
  }

  return (
    <View style={styles.card} testID="friends-card">
      <Text style={styles.title}>Friends</Text>
      <SearchInput
        value={query}
        onChangeText={setQuery}
        placeholder="Find riders by nick"
        testID="rider-search"
      />
      {query.trim() ? (
        prefix ? (
          <SearchResults prefix={prefix} onPressRider={onPressRider} />
        ) : (
          <Text style={styles.notice}>Nicks use letters, digits and underscores.</Text>
        )
      ) : (
        <FriendLists onPressRider={onPressRider} />
      )}
    </View>
  )
}

function SearchResults({
  prefix,
  onPressRider,
}: {
  prefix: string
  onPressRider: (rider: RiderProfile) => void
}) {
  const [result, setResult] = useState<{ prefix: string; items: RiderProfile[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      searchRiders(prefix).then(
        (items) => {
          if (!live) return
          setResult({ prefix, items })
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(friendsErrorMessage(cause))
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [prefix])

  if (error) return <Text style={styles.error}>{error}</Text>
  if (!result) return <Text style={styles.notice}>Searching…</Text>
  if (!result.items.length) return <Text style={styles.notice}>No riders found.</Text>
  return (
    <View>
      {result.items.map((rider) => (
        <FriendRow
          key={rider.accountId}
          nick={rider.nick}
          nationality={rider.nationality}
          onPress={() => onPressRider(rider)}
          trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
        />
      ))}
    </View>
  )
}

function FriendLists({ onPressRider }: { onPressRider: (rider: RiderProfile) => void }) {
  const lists = useFriendsStore((s) => s.lists)
  const loaded = useFriendsStore((s) => s.loaded)
  const error = useFriendsStore((s) => s.error)
  const nowMs = useMinuteNow()
  const friends = sortFriends(lists.friends)

  return (
    <View style={styles.sections}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {lists.incoming.length ? (
        <View>
          <Text style={styles.section}>Requests</Text>
          {lists.incoming.map((rider) => (
            <FriendRow
              key={rider.accountId}
              nick={rider.nick}
              nationality={rider.nationality}
              status="Wants to be friends"
              onPress={() => onPressRider(rider)}
              trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
            />
          ))}
        </View>
      ) : null}
      {friends.length ? (
        <View testID="friends-list">
          {friends.map((friend) => (
            <FriendRow
              key={friend.accountId}
              nick={friend.nick}
              nationality={friend.nationality}
              status={friendStatus(friend, nowMs)}
              riding={friend.ridingNow}
              onPress={() => onPressRider(friend)}
            />
          ))}
        </View>
      ) : loaded ? (
        <Text style={styles.notice}>Find riders by nick to add friends.</Text>
      ) : null}
      {lists.outgoing.length ? (
        <View>
          <Text style={styles.section}>Sent</Text>
          {lists.outgoing.map((rider) => (
            <FriendRow
              key={rider.accountId}
              nick={rider.nick}
              nationality={rider.nationality}
              onPress={() => onPressRider(rider)}
              trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  title: { color: theme.neutral.textPrimary, fontSize: 15, fontWeight: '700' },
  section: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sections: { gap: 8 },
  notice: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
  error: { color: theme.status.error.text, fontSize: 12 },
})
