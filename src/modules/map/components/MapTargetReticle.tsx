import { StyleSheet, View } from 'react-native'
import Animated, { withTiming } from 'react-native-reanimated'

import { theme } from '@/constants/theme'

const pulseEntering = () => {
  'worklet'
  return {
    initialValues: { opacity: 0.65, transform: [{ scale: 0.75 }] },
    animations: {
      opacity: withTiming(0, { duration: 320 }),
      transform: [{ scale: withTiming(2.05, { duration: 320 }) }],
    },
  }
}

/** Shared map-centre target: a bright lens over the map with a coloured reticle. */
export function MapTargetReticle({ color, pulseKey = 0 }: { color: string; pulseKey?: number }) {
  return (
    <View style={styles.frame} pointerEvents="none">
      {pulseKey > 0 ? (
        <Animated.View
          key={pulseKey}
          entering={pulseEntering}
          style={[styles.pulse, { borderColor: color }]}
        />
      ) : null}
      <View style={[styles.lens, { borderColor: color }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  lens: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.4),
  },
  pulse: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.3),
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
