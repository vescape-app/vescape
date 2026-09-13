import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import type { ReadingRange } from '@/modules/hardware/lib/sensorRuntime'

interface SensorBarProps {
  value: SharedValue<number>
  range: ReadingRange
  color: string
}

const HEIGHT = 4

/**
 * A reading drawn as a proportion of its range, for sensors whose numbers move faster than they
 * can be read. Scaled rather than resized: a width animation lays the row out again on every
 * frame, while a transform is the UI thread moving one already-measured view — the same reason
 * the numbers beside it are shared values and not React state.
 */
export function SensorBar({ value, range, color }: SensorBarProps) {
  const span = range.max - range.min
  const style = useAnimatedStyle(() => {
    const current = value.value
    if (Number.isNaN(current) || span <= 0) return { transform: [{ scaleX: 0 }] }
    return {
      transform: [{ scaleX: Math.min(Math.max((current - range.min) / span, 0), 1) }],
    }
  })

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: theme.neutral.border,
    overflow: 'hidden',
  },
  fill: {
    height: HEIGHT,
    // Anchored left so the bar grows out of its origin instead of from its middle.
    transformOrigin: 'left',
    width: '100%',
  },
})
