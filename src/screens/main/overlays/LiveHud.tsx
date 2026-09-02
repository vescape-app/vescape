import { StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { DualGaugeIndicator } from '@/modules/board/components/DualGaugeIndicator'
import { GpsStatusPill } from '@/modules/board/components/GpsStatusPill'
import { useGpsStatusBadge } from '@/modules/board/hooks/useGpsStatusBadge'

interface LiveHudProps {
  revealProgress?: SharedValue<number>
}

export function LiveHud({ revealProgress }: LiveHudProps) {
  const insets = useSafeAreaInsets()
  // Hangs under the gauges: it qualifies the speed and distance they are showing.
  const gpsBadge = useGpsStatusBadge()
  const revealStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: revealProgress ? -52 * revealProgress.value : 0 }],
  }))

  return (
    <Animated.View
      style={[styles.wrap, { paddingTop: Math.max(insets.top + 46, 64) }]}
      pointerEvents="box-none"
    >
      <Animated.View style={revealStyle}>
        <DualGaugeIndicator compact transparent />
        {gpsBadge ? <GpsStatusPill badge={gpsBadge} style={styles.gpsBadge} /> : null}
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  gpsBadge: {
    marginTop: 6,
  },
})
