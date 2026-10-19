// THROWAWAY radial gesture handle, shared by the three prototype variants.
import { use } from 'react'
import { selectionAsync } from 'expo-haptics'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { theme } from '@/constants/theme'
import { valueRadius, radiusValue } from '../lib/ringGeometry'
const bound = (n: number) => Math.max(0, Math.min(100, n))
export function RingHandle({
  value,
  angle,
  radius,
  center,
  normalizedStep,
  range,
  selected,
  color,
  label,
  onChange,
  onSelect,
  liveValues,
  index,
}: {
  liveValues: SharedValue<number[]>
  index: number
  value: number
  angle: number
  radius: number
  center: number
  normalizedStep: number
  range: { min: number; max: number; now: number }
  selected: boolean
  color: string
  label: string
  onChange: (value: number) => void
  onSelect: () => void
}) {
  'use no memo'
  const pagerGesture = use(NativeScrollGestureContext)
  const start = useSharedValue(value)
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.set(liveValues.value[index])
      scheduleOnRN(onSelect)
    })
    .onUpdate((event) => {
      const movement = Math.cos(angle) * event.translationX + Math.sin(angle) * event.translationY
      const raw = radiusValue(valueRadius(start.value, radius) + movement, radius)
      const step = normalizedStep
      const next = Math.max(0, Math.min(100, Math.round(raw / step) * step))
      if (Math.abs(next - liveValues.value[index]) < step * 0.5) return
      scheduleOnRN(selectionAsync)
      liveValues.modify((values) => {
        values[index] = next
        return values
      })
    })
    .onEnd(() => {
      scheduleOnRN(onChange, liveValues.value[index])
    })
  if (pagerGesture) gesture.blocksExternalGesture(pagerGesture)
  const animated = useAnimatedStyle(() => {
    const a = angle
    const r = valueRadius(liveValues.value[index], radius)
    return {
      transform: [
        { translateX: center + Math.cos(a) * r - 22 },
        { translateY: center + Math.sin(a) * r - 22 },
      ],
    }
  })
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={range}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          onChange(
            bound(
              value +
                (event.nativeEvent.actionName === 'increment' ? normalizedStep : -normalizedStep),
            ),
          )
        }
        style={[styles.target, animated]}
      >
        <View
          style={[
            styles.handle,
            {
              borderColor: color,
              backgroundColor: selected ? color : theme.neutral.surface,
              borderWidth: 2,
            },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  target: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: 23, height: 23, borderRadius: 12 },
})
