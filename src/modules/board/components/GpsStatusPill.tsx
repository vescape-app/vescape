import { GpsFixIcon, GpsSlashIcon } from 'phosphor-react-native'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
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
}: {
  badge: GpsStatusBadge
  style?: StyleProp<ViewStyle>
}) {
  const Icon = badge.kind === 'off' || badge.kind === 'blocked' ? GpsSlashIcon : GpsFixIcon

  return (
    <View pointerEvents="none" style={[styles.row, style]}>
      <View style={styles.pill}>
        <Icon size={13} color={theme.neutral.textMuted} weight="bold" />
        <Text style={styles.label} numberOfLines={1}>
          {badge.label}
        </Text>
      </View>
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
    borderColor: theme.neutral.border,
    backgroundColor: theme.alpha(theme.neutral.bg, 0.85),
  },
  label: {
    fontFamily: theme.font('600'),
    fontSize: 11,
    color: theme.neutral.textSecondary,
  },
})
