import { Pressable, StyleSheet, View } from 'react-native'
import type { Favorite } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { widgetSurface } from '@/components/widgets/widgetSurface'
import { interaction, theme } from '@/constants/theme'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import { formatFavoriteName, formatRideListDetails } from '@/modules/history/lib/rideFormat'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const CARD_WIDTH = 148
const PREVIEW_HEIGHT = 76

interface FavoriteRideCardProps {
  favorite: Favorite
  routePoints: RoutePoint[]
  onPress: () => void
}

/** A Favorite as a browsable card: its route large enough to recognise, then name and figures. */
export function FavoriteRideCard({ favorite, routePoints, onPress }: FavoriteRideCardProps) {
  const name = formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs)

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <View style={styles.preview}>
        <RouteSparkline
          points={routePoints}
          width={CARD_WIDTH - 16}
          height={PREVIEW_HEIGHT}
          color={theme.palette.amber.color}
        />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {formatRideListDetails(favorite.movingDurationMs, favorite.distanceM, null)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    ...widgetSurface,
    width: CARD_WIDTH,
    padding: 8,
    gap: 4,
  },
  pressed: {
    backgroundColor: interaction.pressedBg,
  },
  preview: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.palette.amber.color, 0.1),
  },
  name: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  meta: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
  },
})
