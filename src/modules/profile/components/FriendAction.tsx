import { View, StyleSheet } from 'react-native'
import { CheckIcon, UserPlusIcon, UsersIcon, XIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { friendRelation } from '@/modules/profile/lib/friends'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/** The one friend action that fits where this rider stands: add, withdraw, answer, or none. */
export function FriendAction({ accountId, nick }: { accountId: string; nick: string }) {
  const ownId = useRiderProfileStore((s) => s.profile?.accountId ?? null)
  const relation = useFriendsStore((s) => friendRelation(s.lists, accountId, ownId))
  const busy = useFriendsStore((s) => s.busy.includes(accountId))
  const loaded = useFriendsStore((s) => s.loaded)
  const { request, accept, dismissRequest } = useFriendsStore.getState()

  if (!loaded || relation === 'self') return null
  if (relation === 'friend') {
    return (
      <View style={styles.tag}>
        <UsersIcon size={15} color={theme.palette.purple.color} />
        <Text style={styles.caption}>Friends</Text>
      </View>
    )
  }
  if (relation === 'incoming') {
    return (
      <View style={styles.pair}>
        <IconButton
          icon={XIcon}
          size="sm"
          disabled={busy}
          onPress={() => void dismissRequest(accountId)}
          accessibilityLabel={`Decline ${nick}`}
        />
        <IconButton
          icon={CheckIcon}
          size="sm"
          accent={theme.palette.green.color}
          disabled={busy}
          onPress={() => void accept(accountId)}
          accessibilityLabel={`Accept ${nick}`}
        />
      </View>
    )
  }
  if (relation === 'outgoing') {
    return (
      <Button
        label="Requested"
        icon={XIcon}
        size="sm"
        variant="secondary"
        loading={busy}
        onPress={() => void dismissRequest(accountId)}
        accessibilityLabel={`Withdraw request to ${nick}`}
      />
    )
  }
  return (
    <Button
      label="Add friend"
      icon={UserPlusIcon}
      size="sm"
      variant="secondary"
      loading={busy}
      onPress={() => void request(accountId)}
      accessibilityLabel={`Add ${nick} as friend`}
    />
  )
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pair: { flexDirection: 'row', gap: 8 },
  caption: { color: theme.neutral.textSecondary, fontSize: 11 },
})
