import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { BroadcastIcon, CaretRightIcon, UserCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
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
  onPress,
  trailing,
  testID,
  divided = false,
}: {
  nick: string
  nationality: string | null
  status?: string | null
  riding?: boolean
  onPress: () => void
  trailing?: ReactNode
  testID?: string
  divided?: boolean
}) {
  const neutral = useResolvedNeutralColors()
  const dotColor = riding ? theme.palette.groupRide.color : neutral.textSecondary
  return (
    <View
      style={[
        styles.row,
        divided && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: neutral.border },
      ]}
      testID={testID}
    >
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.identity}>
        <View accessible={false}>
          <UserCircleIcon size={32} color={neutral.textSecondary} weight="thin" />
          {status ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.nick}>
          {nick}
          {nationality ? <Text style={styles.caption}>{`  ${nationality}`}</Text> : null}
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
        {riding ? <CaretRightIcon size={14} color={neutral.textSecondary} /> : null}
      </Pressable>
      {trailing}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 48 },
  identity: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
  },
  dot: { position: 'absolute', top: 1, left: 1, width: 8, height: 8, borderRadius: 4 },
  nick: { flex: 1, minWidth: 0, color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  caption: { color: theme.neutral.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
})
