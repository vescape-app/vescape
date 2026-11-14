import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const PULSE_MS = 900
const PULSE_STAGGER_MS = 160
const MIN_OPACITY = 0.4
const MAX_OPACITY = 0.75

interface SkeletonPulseProps {
  /** Position in a row of skeletons; offsets the pulse so it ripples across them. */
  index?: number
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/** Fades its children in and out while content loads. Honors the system reduce-motion setting. */
export function SkeletonPulse({ index = 0, style, children }: SkeletonPulseProps) {
  const pulse = useSharedValue(0)

  useEffect(() => {
    pulse.value = withDelay(
      index * PULSE_STAGGER_MS,
      withRepeat(
        withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
        undefined,
        ReduceMotion.System,
      ),
    )
    return () => cancelAnimation(pulse)
  }, [index, pulse])

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: MIN_OPACITY + pulse.value * (MAX_OPACITY - MIN_OPACITY),
  }))

  return <Animated.View style={[style, pulseStyle]}>{children}</Animated.View>
}

interface SkeletonLineProps {
  /** Line height of the text it stands in for, so the swap keeps the layout. */
  lineHeight: number
  width: DimensionValue
}

/**
 * Rounded bar standing in for one line of text. Its height comes from an invisible text line,
 * not a fixed box, so it rounds to the pixel grid exactly like the text it replaces (Android rounds
 * line heights up to whole pixels).
 */
export function SkeletonLine({ lineHeight, width }: SkeletonLineProps) {
  const neutral = useResolvedNeutralColors()
  const thickness = Math.round(lineHeight * 0.55)
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={{ lineHeight, fontSize: thickness }}> </Text>
      <View style={styles.bar}>
        <View
          style={{
            width,
            height: thickness,
            borderRadius: thickness / 2,
            backgroundColor: neutral.border,
          }}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
})
