import { forwardRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'

import { interaction, theme, type ThemeColor } from '@/constants/theme'
import { HistoryRideLabel } from '@/modules/history/components/HistoryRideLabel'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import { HISTORY_RIDE_ROW_HEIGHT } from '@/modules/history/lib/historyList'
import type { RoutePoint } from '@/modules/history/lib/routePreview'
import { RideWeatherLabel } from '@/modules/history/components/RideWeatherLabel'
import type { RideWeather } from 'vescape-core'

const PREVIEW_WIDTH = 86
const ROW_HEIGHT = HISTORY_RIDE_ROW_HEIGHT

interface HistoryRideRowProps {
  title: string
  subtitle: string
  details?: string
  routePoints: RoutePoint[]
  selected?: boolean
  /** Route line color; Favorites ride under their own accent. */
  accent?: ThemeColor
  onPress: () => void
  testID?: string
  /** Ride weather beside the stats; null renders nothing. */
  weather?: RideWeather | null
}

/** One ride as a list row: route thumbnail, identity, chevron. The ride list and the History drawer
 *  share it so a ride looks the same wherever it is listed. */
export const HistoryRideRow = forwardRef<View, HistoryRideRowProps>(function HistoryRideRow(
  {
    title,
    subtitle,
    details,
    routePoints,
    selected = false,
    accent,
    onPress,
    testID,
    weather = null,
  },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.preview}>
        <RouteSparkline
          points={routePoints}
          width={PREVIEW_WIDTH}
          height={ROW_HEIGHT - 2}
          color={selected ? theme.palette.sky.color : (accent ?? theme.palette.purple.color)}
          endpoints
          style={styles.previewImage}
        />
      </View>
      <View style={styles.main}>
        <HistoryRideLabel title={title} subtitle={subtitle} details={details} fill={false} />
      </View>
      {weather ? (
        <RideWeatherLabel weather={weather} color={theme.neutral.textSecondary} fontSize={12} />
      ) : null}
      <CaretRightIcon size={16} color={theme.neutral.textDim} weight="bold" />
    </Pressable>
  )
})

/** Same footprint as a ride row so paging can extend the scroll area while native reads. */
export function HistoryRideRowSkeleton() {
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.preview, styles.skeletonBlock]} />
      <View style={[styles.main, styles.skeletonDetails]}>
        <View style={[styles.skeletonBlock, styles.skeletonTitle]} />
        <View style={[styles.skeletonBlock, styles.skeletonSubtitle]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  skeletonBlock: {
    opacity: 0.5,
    backgroundColor: theme.neutral.border,
  },
  skeletonDetails: {
    gap: 8,
  },
  skeletonTitle: {
    width: '58%',
    height: 14,
    borderRadius: 4,
  },
  skeletonSubtitle: {
    width: '85%',
    height: 10,
    borderRadius: 3,
  },
  row: {
    height: ROW_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  rowSelected: {
    borderColor: theme.palette.sky.color,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  main: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  preview: {
    width: PREVIEW_WIDTH,
    height: ROW_HEIGHT - 2,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  previewImage: {
    borderRadius: 0,
  },
})
