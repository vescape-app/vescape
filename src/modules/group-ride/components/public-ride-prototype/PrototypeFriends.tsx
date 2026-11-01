import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CheckIcon, UserCircleIcon, UserPlusIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { usePublicRidePrototypeStore } from './prototypeStore'

export function InactiveFriends({
  followsActive,
  onSelect,
}: {
  followsActive: boolean
  onSelect: (id: string) => void
}) {
  const friends = usePublicRidePrototypeStore((state) => state.inactiveFriends)
  const neutral = useResolvedNeutralColors()
  return (
    <View>
      {friends.map((friend, index) => (
        <Pressable
          key={friend.id}
          accessibilityRole="button"
          accessibilityLabel={`View ${friend.name}, ${friend.lastSeen}`}
          onPress={() => onSelect(friend.id)}
          style={[
            styles.row,
            (followsActive || index > 0) && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: neutral.border,
            },
          ]}
        >
          <View accessible={false}>
            <UserCircleIcon size={32} color={neutral.textSecondary} weight="thin" />
            <View style={[styles.dot, { backgroundColor: neutral.textSecondary }]} />
          </View>
          <Text numberOfLines={1} style={[styles.name, { color: neutral.textPrimary }]}>
            {friend.name}
          </Text>
          <Text style={[styles.lastSeen, { color: neutral.textSecondary }]}>{friend.lastSeen}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function AddFriendButton() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const addFriend = usePublicRidePrototypeStore((state) => state.addDemoFriend)
  const neutral = useResolvedNeutralColors()
  const add = () => {
    if (!name.trim()) return
    addFriend(name)
    setOpen(false)
  }
  return (
    <>
      <Button
        label="Add friend"
        icon={UserPlusIcon}
        size="sm"
        accent={theme.palette.blue.color}
        style={styles.action}
        onPress={() => {
          setName('')
          setOpen(true)
        }}
      />
      <FadeCardModal
        visible={open}
        title="Add a friend"
        titleIcon={UserPlusIcon}
        titleIconColor={theme.palette.blue.color}
        scrollable={false}
        onDismiss={() => setOpen(false)}
      >
        <View style={styles.form}>
          <Text style={{ color: neutral.textSecondary, fontSize: 12 }}>
            Enter a name to preview your friends list.
          </Text>
          <View style={styles.inputRow}>
            <Input
              value={name}
              onChangeText={setName}
              maxLength={32}
              style={styles.input}
              placeholder="Friend’s name"
              accessibilityLabel="Friend’s name"
              returnKeyType="done"
              onSubmitEditing={add}
            />
            <IconButton
              icon={CheckIcon}
              accent={theme.palette.blue.color}
              disabled={!name.trim()}
              onPress={add}
              accessibilityLabel="Add friend"
            />
          </View>
        </View>
      </FadeCardModal>
    </>
  )
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 48, paddingVertical: 8 },
  dot: { position: 'absolute', top: 1, left: 1, width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700' },
  lastSeen: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  action: { alignSelf: 'flex-end', marginTop: 4 },
  form: { gap: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, minWidth: 0 },
})
