import { forwardRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'

import { interaction, theme } from '@/constants/theme'
import { HistoryRideLabel } from '@/modules/history/components/HistoryRideLabel'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const PREVIEW_WIDTH = 74
const PREVIEW_HEIGHT = 52

interface HistoryRideRowProps {
  title: string
  subtitle: string
  details?: string
  routePoints: RoutePoint[]
  selected?: boolean
  /** Route line color; Favorites ride under their own accent. */
  accent?: string
  onPress: () => void
  testID?: string
}

/** One ride as a list row: route thumbnail, identity, chevron. The ride list and the History drawer
 *  share it so a ride looks the same wherever it is listed. */
export const HistoryRideRow = forwardRef<View, HistoryRideRowProps>(function HistoryRideRow(
  { title, subtitle, details, routePoints, selected = false, accent, onPress, testID },
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
      <RouteSparkline
        points={routePoints}
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        color={accent ?? (selected ? theme.palette.sky.color : theme.palette.purple.color)}
        endpoints
      />
      <View style={styles.main}>
        <HistoryRideLabel title={title} subtitle={subtitle} details={details} />
      </View>
      <CaretRightIcon size={16} color={theme.palette.slate.textDim} weight="bold" />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  },
})
