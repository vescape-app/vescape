import { StyleSheet, View } from 'react-native'
import Animated, { FadeOut, withTiming } from 'react-native-reanimated'

import { theme } from '@/constants/theme'

const pointerEntering = () => {
  'worklet'
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 1.2 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 260 }),
      transform: [{ scale: withTiming(1, { duration: 260 }) }],
    },
  }
}

const pulseEntering = () => {
  'worklet'
  return {
    initialValues: {
      opacity: 0.65,
      transform: [{ scale: 0.75 }],
    },
    animations: {
      opacity: withTiming(0, { duration: 320 }),
      transform: [{ scale: withTiming(2.05, { duration: 320 }) }],
    },
  }
}

/** The viewfinder the add menu places a feature at, pulsing once per placement. */
export function CenterPlacementPointer({ color, pulseKey }: { color: string; pulseKey: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      entering={pointerEntering}
      exiting={FadeOut.duration(140)}
      style={styles.pointer}
    >
      {pulseKey > 0 ? (
        <Animated.View
          key={pulseKey}
          entering={pulseEntering}
          style={[styles.pulse, { borderColor: color }]}
        />
      ) : null}
      <View style={[styles.ball, { borderColor: color }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  pointer: {
    ...StyleSheet.absoluteFill,
    zIndex: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ball: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.4),
  },
  pulse: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.3),
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
