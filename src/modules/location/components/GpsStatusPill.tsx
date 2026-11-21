import { GpsFixIcon, GpsSlashIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import type { GpsStatusBadge } from '@/modules/location/lib/gpsStatusBadge'

export function GpsStatusPill({
  badge,
  style,
  onPress,
}: {
  badge: GpsStatusBadge
  style?: StyleProp<ViewStyle>
  onPress?: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const pillStyle = {
    borderColor: neutral.border,
    backgroundColor: theme.alpha(neutral.bg, 0.85),
  }
  const Icon = badge.kind === 'off' || badge.kind === 'blocked' ? GpsSlashIcon : GpsFixIcon
  const content = (
    <>
      <Icon size={13} color={neutral.textMuted} weight="bold" />
      <Text style={[styles.label, { color: neutral.textSecondary }]} numberOfLines={1}>
        {badge.label}
      </Text>
    </>
  )

  if (!onPress) {
    return (
      <View pointerEvents="none" style={[styles.row, style]}>
        <View style={[styles.pill, pillStyle]}>{content}</View>
      </View>
    )
  }

  return (
    <View pointerEvents="box-none" style={[styles.row, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={badge.label}
        hitSlop={8}
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pillStyle, pressed && styles.pillPressed]}
      >
        {content}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  pillPressed: {
    opacity: 0.6,
  },
  label: {
    fontFamily: theme.font('600'),
    fontSize: 11,
  },
})
