/* eslint-disable react-hooks/immutability */
import { useMemo } from 'react'
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { MAX_PITCH_INPUT_DEGREES } from '@/modules/tune/lib/tunePreview'

interface PitchInputControlProps {
  angleDegrees: SharedValue<number>
  active: SharedValue<boolean>
}

const THUMB_SIZE = 18

export function PitchInputControl({ angleDegrees, active }: PitchInputControlProps) {
  const width = useSharedValue(0)

  const gesture = useMemo(() => {
    const updateFromX = (x: number) => {
      'worklet'
      const travel = Math.max(width.value - THUMB_SIZE, 1)
      const thumbLeft = Math.max(0, Math.min(travel, x - THUMB_SIZE / 2))
      angleDegrees.value = ((thumbLeft / travel) * 2 - 1) * MAX_PITCH_INPUT_DEGREES
    }

    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => {
        active.value = true
        updateFromX(event.x)
      })
      .onUpdate((event) => updateFromX(event.x))
      .onFinalize(() => {
        active.value = false
        angleDegrees.value = 0
      })
  }, [active, angleDegrees, width])

  const thumbStyle = useAnimatedStyle(() => {
    const travel = Math.max(width.value - THUMB_SIZE, 0)
    const normalized = angleDegrees.value / MAX_PITCH_INPUT_DEGREES
    return { transform: [{ translateX: ((1 + normalized) / 2) * travel }] }
  })
  const handleLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width
  }

  return (
    <View style={styles.container}>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.trackTouch}
          onLayout={handleLayout}
          accessible
          accessibilityLabel="Hold and drag to apply pitch input, then release"
        >
          <View style={styles.track} />
          <View style={styles.centerMark} />
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        <Text style={styles.edgeLabel}>Nose</Text>
        <Text style={styles.hint}>Hold to add pitch rate · release to recover</Text>
        <Text style={styles.edgeLabel}>Tail</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 5 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  edgeLabel: { color: theme.palette.slate.textMuted, fontSize: 10, fontWeight: '700' },
  hint: {
    flex: 1,
    color: theme.palette.slate.textMuted,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  trackTouch: { height: 30, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.palette.slate.border },
  centerMark: {
    position: 'absolute',
    left: '50%',
    width: 1,
    height: 10,
    backgroundColor: theme.palette.slate.textMuted,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: theme.palette.sky.color,
    borderWidth: 2,
    borderColor: theme.palette.slate.textPrimary,
  },
})
