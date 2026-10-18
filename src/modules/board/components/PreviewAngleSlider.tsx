import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import { theme } from '@/constants/theme'

const THUMB_SIZE = 16
const CENTER_SNAP_DEGREES = 10

export function PreviewAngleSlider({
  value,
  vertical = false,
}: {
  value: SharedValue<number | null>
  vertical?: boolean
}) {
  const length = useSharedValue(1)
  const gesture = useMemo(() => {
    const update = (position: number) => {
      'worklet'
      const travel = Math.max(length.value - THUMB_SIZE, 1)
      const thumbStart = Math.max(0, Math.min(travel, position - THUMB_SIZE / 2))
      const angle = Math.round(-90 + (thumbStart / travel) * 180)
      value.value = Math.abs(angle) <= CENTER_SNAP_DEGREES ? 0 : angle
    }
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => update(vertical ? event.y : event.x))
      .onUpdate((event) => update(vertical ? event.y : event.x))
  }, [length, value, vertical])
  const thumbStyle = useAnimatedStyle(() => {
    const travel = Math.max(length.value - THUMB_SIZE, 0)
    const ratio = Math.max(0, Math.min(1, ((value.value ?? 0) + 90) / 180))
    return vertical
      ? { transform: [{ translateY: ratio * travel }] }
      : { transform: [{ translateX: ratio * travel }] }
  })
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={vertical ? styles.sliderVertical : styles.sliderHorizontal}
        onLayout={(event) => {
          length.value = vertical ? event.nativeEvent.layout.height : event.nativeEvent.layout.width
        }}
      >
        <View style={vertical ? styles.trackVertical : styles.trackHorizontal} />
        <View style={vertical ? styles.centerVertical : styles.centerHorizontal} />
        <Animated.View style={[styles.thumb, vertical && styles.thumbVertical, thumbStyle]} />
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  sliderHorizontal: { width: '100%', height: 24, justifyContent: 'center' },
  sliderVertical: { width: 22, flex: 1, alignItems: 'center' },
  trackHorizontal: { height: 2, marginHorizontal: 8, backgroundColor: theme.neutral.border },
  trackVertical: {
    width: 2,
    marginVertical: 8,
    flex: 1,
    backgroundColor: theme.neutral.border,
  },
  centerHorizontal: {
    position: 'absolute',
    left: '50%',
    top: 7,
    width: 1,
    height: 10,
    backgroundColor: theme.neutral.textMuted,
  },
  centerVertical: {
    position: 'absolute',
    top: '50%',
    left: 5,
    width: 12,
    height: 1,
    backgroundColor: theme.neutral.textMuted,
  },
  thumb: {
    position: 'absolute',
    top: 4,
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    borderColor: theme.palette.cyan.color,
    backgroundColor: theme.neutral.bg,
  },
  thumbVertical: { top: 0, left: 3 },
})
