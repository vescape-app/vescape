import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { MagnifyingGlassIcon, UserPlusIcon, UsersIcon, WifiSlashIcon } from 'phosphor-react-native'
import { searchRiders, type Friend, type RiderProfile } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { FriendAction } from '@/modules/profile/components/FriendAction'
import { FriendRow } from '@/modules/profile/components/FriendRow'
import {
  friendStatus,
  friendsErrorMessage,
  riderSearchPrefix,
  sortFriends,
} from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

const SEARCH_DEBOUNCE_MS = 300

type OpenRider = (accountId: string) => void

export function SocialFriendsSignIn({ search }: { search: boolean }) {
  return (
    <Placeholder
      compact
      icon={search ? MagnifyingGlassIcon : UsersIcon}
      title={search ? 'Find riders' : 'Friends'}
      description={search ? 'Sign in to search for riders.' : 'Sign in to see your friends.'}
    />
  )
}

export function SocialRiderSearchResults({
  query,
  onOpenRider,
}: {
  query: string
  onOpenRider: OpenRider
}) {
  const prefix = riderSearchPrefix(query)
  const error = useFriendsStore((s) => s.error)

  return (
    <View style={styles.sections}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {prefix ? (
        <SearchResults key={prefix} prefix={prefix} onOpenRider={onOpenRider} />
      ) : query.trim() ? (
        <Text style={styles.notice}>Use up to 20 letters, digits or underscores.</Text>
      ) : (
        <Placeholder
          compact
          icon={MagnifyingGlassIcon}
          title="Find riders"
          description="Enter a nick to find riders."
        />
      )}
    </View>
  )
}

function SearchResults({ prefix, onOpenRider }: { prefix: string; onOpenRider: OpenRider }) {
  const [result, setResult] = useState<RiderProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      searchRiders(prefix).then(
        (items) => {
          if (!live) return
          setResult(items)
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
  if (!result.length)
    return (
      <Placeholder
        compact
        icon={MagnifyingGlassIcon}
        title="No riders found"
        description="Try a different nick."
      />
    )
  return (
    <View>
      {result.map((rider) => (
        <FriendRow
          key={rider.accountId}
          nick={rider.nick}
          nationality={rider.nationality}
          onPress={() => onOpenRider(rider.accountId)}
          trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
        />
      ))}
    </View>
  )
}

export function SocialFriendLists({
  onSearch,
  onOpenRider,
  renderRidingFriend,
}: {
  onSearch: () => void
  renderRidingFriend?: (friend: Friend, divided: boolean) => ReactNode
  onOpenRider: OpenRider
}) {
  const lists = useFriendsStore((s) => s.lists)
  const loaded = useFriendsStore((s) => s.loaded)
  const loading = useFriendsStore((s) => s.loading)
  const loadError = useFriendsStore((s) => s.loadError)
  const load = useFriendsStore((s) => s.load)
  const error = useFriendsStore((s) => s.error)
  const nowMs = useMinuteNow()
  const friends = sortFriends(lists.friends)

  return (
    <View style={styles.sections} testID="friends-card">
      {loadError ? (
        <Placeholder
          compact
          icon={loadError.unreachable ? WifiSlashIcon : UsersIcon}
          title="Couldn’t refresh friends"
          description={
            loadError.unreachable ? 'Vescape couldn’t connect to the server.' : loadError.message
          }
          action={
            <Button
              label="Try again"
              size="sm"
              variant="secondary"
              loading={loading}
              onPress={() => void load()}
            />
          }
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {lists.incoming.length ? (
        <View>
          <Text style={styles.section}>Requests</Text>
          {lists.incoming.map((rider) => (
            <FriendRow
              key={rider.accountId}
              nick={rider.nick}
              nationality={rider.nationality}
              onPress={() => onOpenRider(rider.accountId)}
              status="Wants to be friends"
              trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
            />
          ))}
        </View>
      ) : null}
      {friends.length ? (
        <>
          <View testID="friends-list">
            {friends.map(
              (friend, index) =>
                (friend.ridingNow && renderRidingFriend?.(friend, index > 0)) || (
                  <FriendRow
                    key={friend.accountId}
                    nick={friend.nick}
                    status={friendStatus(friend, nowMs)}
                    nationality={null}
                    riding={friend.ridingNow}
                    divided={index > 0}
                    onPress={() => onOpenRider(friend.accountId)}
                  />
                ),
            )}
          </View>
          <Button
            label="Add friend"
            icon={UserPlusIcon}
            size="sm"
            accent={theme.palette.blue.color}
            style={styles.addFriend}
            onPress={onSearch}
          />
        </>
      ) : loaded && !loadError ? (
        <Placeholder
          compact
          icon={UsersIcon}
          title="No friends yet"
          description="Find riders by nick to add them as friends."
          action={
            <Button
              label="Find riders"
              size="sm"
              variant="groupRide"
              icon={MagnifyingGlassIcon}
              onPress={onSearch}
            />
          }
        />
      ) : !loaded && !loadError ? (
        <Text style={styles.notice}>Loading friends…</Text>
      ) : null}
      {lists.outgoing.length ? (
        <View>
          <Text style={styles.section}>Sent</Text>
          {lists.outgoing.map((rider) => (
            <FriendRow
              key={rider.accountId}
              nick={rider.nick}
              nationality={rider.nationality}
              onPress={() => onOpenRider(rider.accountId)}
              trailing={<FriendAction accountId={rider.accountId} nick={rider.nick} />}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sections: { gap: 8 },
  addFriend: { alignSelf: 'flex-end' },
  notice: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
  error: { color: theme.status.error.text, fontSize: 12 },
})
