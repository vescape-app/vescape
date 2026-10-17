import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { Circle } from 'react-native-svg'
import { handleCircle } from './tuneRingGeometry'
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'

// Counter the native page translation. The plot travels at 76% of the text's speed.
export function TuneRingParallaxLayer({
  position,
  section,
  pageWidth,
  children,
}: {
  position?: SharedValue<number>
  section: number
  pageWidth: number
  children: ReactNode
}) {
  'use no memo'
  const motion = useAnimatedStyle(() => {
    const distance = position ? position.value / pageWidth - section : 0
    return {
      transform: [{ translateX: distance * pageWidth * 0.24 }],
      opacity: Math.max(0.4, 1 - Math.abs(distance) * 0.6),
    }
  })
  return <Animated.View style={[StyleSheet.absoluteFill, motion]}>{children}</Animated.View>
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export function TuneRingSavedCircle({
  values,
  liveValues,
  radius,
  center,
  color,
}: {
  values?: number[]
  liveValues: SharedValue<number[]>
  radius: number
  center: number
  color: string
}) {
  'use no memo'
  const visibility = useAnimatedProps(() => ({
    strokeOpacity: values
      ?.slice(0, 3)
      .some((value, index) => Math.abs(value - liveValues.value[index]) > 0.01)
      ? 0.25
      : 0,
  }))
  if (!values) return null
  return (
    <AnimatedCircle
      animatedProps={visibility}
      {...handleCircle(values, radius, center)}
      fill="none"
      stroke={color}
      strokeWidth={1}
      strokeDasharray="4 6"
    />
  )
}
