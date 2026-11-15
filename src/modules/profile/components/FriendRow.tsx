import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { BroadcastIcon, UserCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/**
 * One rider in a Social list: nick, nationality and a status line, with an optional trailing
 * action. `riding` paints the status in the live colour.
 */
export function FriendRow({
  nick,
  nationality,
  status,
  riding = false,
  trailing,
  onPress,
  testID,
}: {
  nick: string
  nationality: string | null
  status?: string | null
  riding?: boolean
  trailing?: ReactNode
  onPress?: () => void
  testID?: string
}) {
  const label = [nick, nationality, status].filter(Boolean).join(', ')
  return (
    <View style={styles.row} testID={testID}>
      <Pressable
        style={styles.identity}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
      >
        <UserCircleIcon
          size={32}
          color={riding ? theme.palette.green.color : theme.neutral.textSecondary}
          weight="thin"
        />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.nick}>
            {nick}
            {nationality ? <Text style={styles.nationality}>{`  ${nationality}`}</Text> : null}
          </Text>
          {status ? (
            <View style={styles.status}>
              {riding ? <BroadcastIcon size={12} color={theme.palette.green.color} /> : null}
              <Text
                numberOfLines={1}
                style={[styles.caption, riding && { color: theme.palette.green.text }]}
              >
                {status}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {trailing}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, minWidth: 0 },
  nick: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '700' },
  nationality: { color: theme.neutral.textSecondary, fontSize: 11, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  caption: { color: theme.neutral.textSecondary, fontSize: 11 },
})
