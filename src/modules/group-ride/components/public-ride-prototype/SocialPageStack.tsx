import { useMemo, type ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  Keyframe,
  LayoutAnimationConfig,
  ReduceMotion,
} from 'react-native-reanimated'

function motion(from: number, to: number, entering: boolean) {
  return new Keyframe({
    0: { opacity: entering ? 0 : 1, transform: [{ translateX: from }] },
    100: {
      opacity: entering ? 1 : 0,
      transform: [{ translateX: to }],
      easing: Easing.out(Easing.cubic),
    },
  })
    .duration(entering ? 280 : 240)
    .reduceMotion(ReduceMotion.System)
}

/** Keep the outgoing native page alive for its exit, with no per-frame React work. */
export function SocialPageStack({
  page,
  detail,
  children,
}: {
  page: string
  detail: boolean
  children: ReactNode
}) {
  const { width } = useWindowDimensions()
  const animations = useMemo(
    () => ({
      detailIn: motion(width, 0, true),
      detailOut: motion(0, width, false),
      rootIn: motion(-width * 0.24, 0, true),
      rootOut: motion(0, -width * 0.24, false),
    }),
    [width],
  )
  return (
    <LayoutAnimationConfig skipEntering>
      <View collapsable={false} style={styles.viewport}>
        <Animated.View
          key={page}
          entering={detail ? animations.detailIn : animations.rootIn}
          exiting={detail ? animations.detailOut : animations.rootOut}
          style={styles.page}
        >
          {children}
        </Animated.View>
      </View>
    </LayoutAnimationConfig>
  )
}

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  page: { gap: 10 },
})
