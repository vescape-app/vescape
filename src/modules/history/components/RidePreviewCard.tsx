import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { interaction, theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const CARD_WIDTH = 172
const CARD_PADDING = 8
const PREVIEW_HEIGHT = 82

interface RidePreviewCardProps {
  title: string
  subtitle: string
  routePoints: RoutePoint[]
  color: ThemeColor
  onPress: () => void
  testID?: string
  map?: boolean
}

/** Compact ride tile shared by recent rides and Favorites in the History drawer. */
export function RidePreviewCard({
  title,
  subtitle,
  routePoints,
  color,
  onPress,
  testID,
  map = true,
}: RidePreviewCardProps) {
  const neutral = useResolvedNeutralColors()

  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: neutral.surface, borderColor: neutral.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.preview}>
        <RouteSparkline
          points={routePoints}
          width={CARD_WIDTH - CARD_PADDING * 2}
          height={PREVIEW_HEIGHT}
          color={color}
          map={map}
        />
      </View>
      <Text style={[styles.title, { color: neutral.textPrimary }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.subtitle, { color: neutral.textSecondary }]} numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    padding: CARD_PADDING,
    gap: 4,
    borderWidth: 1,
    borderRadius: 18,
  },
  pressed: {
    backgroundColor: interaction.pressedBg,
  },
  preview: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.control.background,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
    minHeight: 34,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
    minHeight: 30,
  },
})
