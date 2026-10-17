// THROWAWAY: claim touches within a narrow band around the live edge.
import { use } from 'react'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { constrainCircleEdit, handleCircle } from './tuneRingGeometry'

export function RingResizeGesture({
  values,
  radius,
  center,
  steps,
  onCommit,
}: {
  values: SharedValue<number[]>
  radius: number
  center: number
  steps: number[]
  onCommit: (values: number[]) => void
}) {
  'use no memo'
  const pagerGesture = use(NativeScrollGestureContext)
  const initial = useSharedValue({ cx: center, cy: center, r: radius })
  const startDistance = useSharedValue(0)
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .minDistance(0)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0]
      if (!touch || event.numberOfTouches !== 1) {
        manager.fail()
        return
      }
      const circle = handleCircle(values.value, radius, center)
      const distance = Math.hypot(touch.x - circle.cx, touch.y - circle.cy)
      if (Math.abs(distance - circle.r) > 12) {
        manager.fail()
        return
      }
      initial.set(circle)
      startDistance.set(distance)
      manager.activate()
    })
    .onUpdate((event) => {
      const circle = initial.value
      const distance = Math.hypot(event.x - circle.cx, event.y - circle.cy)
      const next = constrainCircleEdit(
        circle,
        { ...circle, r: Math.max(1, circle.r + distance - startDistance.value) },
        radius,
        center,
        steps,
        values.value[3],
      )
      if (next) values.set(next)
    })
    .onEnd(() => scheduleOnRN(onCommit, values.value))
  if (pagerGesture) gesture.blocksExternalGesture(pagerGesture)
  const adjust = (delta: number) => {
    const circle = handleCircle(values.get(), radius, center)
    const next = constrainCircleEdit(
      circle,
      { ...circle, r: Math.max(1, circle.r + delta) },
      radius,
      center,
      steps,
      values.get()[3],
    )
    if (next) {
      values.set(next)
      onCommit(next)
    }
  }
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Circle size. Adjust all three parameters."
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          adjust(event.nativeEvent.actionName === 'increment' ? 5 : -5)
        }
      />
    </GestureDetector>
  )
}
