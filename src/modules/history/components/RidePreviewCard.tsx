import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const CARD_WIDTH = 172
const CARD_PADDING = 8
const PREVIEW_HEIGHT = 88

interface RidePreviewCardProps {
  title: string
  date: string
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
  date,
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
        {
          backgroundColor: pressed ? neutral.surface : neutral.surfaceDeep,
          borderColor: neutral.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${date}`}
    >
      <View style={styles.preview}>
        <RouteSparkline
          points={routePoints}
          width={CARD_WIDTH - 2}
          height={PREVIEW_HEIGHT}
          color={color}
          map={map}
          style={styles.previewImage}
        />
      </View>
      <View style={styles.details}>
        <Text style={[styles.title, { color: neutral.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.date, { color: neutral.textSecondary }]} numberOfLines={1}>
          {date}
        </Text>
        <Text style={[styles.subtitle, { color: neutral.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  preview: {
    overflow: 'hidden',
    backgroundColor: theme.control.background,
  },
  previewImage: {
    borderRadius: 0,
  },
  details: {
    padding: CARD_PADDING,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  date: {
    fontSize: 11,
    lineHeight: 15,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
})
