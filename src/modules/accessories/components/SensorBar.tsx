import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { theme, type ThemeColor } from '@/constants/theme'
interface ReadingRange {
  min: number
  max: number
}

interface SensorBarProps {
  value: SharedValue<number>
  range: ReadingRange
  color: ThemeColor
}

const HEIGHT = 4

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
    transformOrigin: 'left',
    width: '100%',
  },
})
