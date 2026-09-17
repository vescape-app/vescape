import { GpsFixIcon, GpsSlashIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import type { GpsStatusBadge } from '@/modules/board/lib/gpsStatusBadge'

/**
 * Why the position on screen cannot be trusted, in the fewest possible pixels. It only ever renders
 * for a GPS that is missing, arming, or delivering something weak — a healthy receiver gets no
 * badge at all, so the pill showing up is itself the signal.
 *
 * Deliberately grey in every state: it explains a reading the rider can already see is off, and a
 * red or amber pill would outrank the alerts and warnings that mean something is wrong with the
 * board.
 */
export function GpsStatusPill({
  badge,
  style,
  onPress,
}: {
  badge: GpsStatusBadge
  style?: StyleProp<ViewStyle>
  /** Given a handler the pill becomes the way in to whatever explains the state it is reporting. */
  onPress?: () => void
}) {
  // Resolved strings, not adaptive tokens: the pill can be mounted across a theme switch, and a
  // native adaptive color only re-resolves when the prop is set again.
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
