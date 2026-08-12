import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useLatestCallback } from '@/hooks/useLatestCallback'

export type FaderReadout = { number: string; word: string }

export function VariantFLiquidFader({
  value,
  color,
  height,
  readouts,
  wide = false,
  onInteraction,
  onChange,
}: {
  value: number
  color: string
  height: number
  readouts: FaderReadout[]
  wide?: boolean
  onInteraction?: () => void
  onChange: (value: number) => void
}) {
  const progress = useSharedValue(value)
  const dragging = useSharedValue(false)
  const notifyInteraction = useLatestCallback(() => onInteraction?.())
  const notifyChange = useLatestCallback((nextValue: number) => onChange(nextValue))

  useEffect(() => {
    if (!dragging.value) progress.value = value
  }, [dragging, progress, value])

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((event) => {
          scheduleOnRN(notifyInteraction)
          dragging.value = true
          progress.value = Math.min(10, Math.max(0, (1 - event.y / height) * 10))
        })
        .onUpdate((event) => {
          progress.value = Math.min(10, Math.max(0, (1 - event.y / height) * 10))
        })
        .onFinalize(() => {
          dragging.value = false
          scheduleOnRN(notifyChange, Math.round(progress.value * 2) / 2)
        }),
    [dragging, height, notifyChange, notifyInteraction, progress],
  )
  const fillStyle = useAnimatedStyle(() => ({ height: (progress.value / 10) * height }))
  const markerStyle = useAnimatedStyle(() => ({
    bottom: Math.max(0, (progress.value / 10) * height - 1),
    opacity: progress.value > 0 ? 1 : 0,
  }))
  const fillGradient = useMemo(
    () =>
      `linear-gradient(to bottom, ${theme.alpha(color, 0.8)} 0%, ${theme.alpha(color, 0.4)} 48%, ${theme.alpha(color, 0.1)} 100%)`,
    [color],
  )

  return (
    <View style={wide ? styles.wideRow : styles.row}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.track, { height }]}>
          <Animated.View style={[styles.fillClip, fillStyle]}>
            <View
              pointerEvents="none"
              style={[styles.fill, { height, experimental_backgroundImage: fillGradient }]}
            />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[styles.valueMarker, { backgroundColor: color }, markerStyle]}
          />
          <View style={styles.ticks} pointerEvents="none">
            {[1, 2, 3, 4].map((tick) => (
              <View key={tick} style={styles.tick} />
            ))}
          </View>
        </Animated.View>
      </GestureDetector>
      <View style={wide ? styles.side : undefined}>
        <SharedStatusReadout progress={progress} readouts={readouts} color={color} />
      </View>
    </View>
  )
}

function SharedStatusReadout({
  progress,
  readouts,
  color,
}: {
  progress: SharedValue<number>
  readouts: FaderReadout[]
  color: string
}) {
  return (
    <View style={styles.status}>
      {readouts.map((readout, index) => (
        <SharedStatusOption
          key={index}
          index={index}
          progress={progress}
          readout={readout}
          color={color}
        />
      ))}
    </View>
  )
}

function SharedStatusOption({
  index,
  progress,
  readout,
  color,
}: {
  index: number
  progress: SharedValue<number>
  readout: FaderReadout
  color: string
}) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.round(progress.value * 2) === index ? 1 : 0,
  }))
  return (
    <Animated.View style={[styles.statusOption, style]} pointerEvents="none">
      <Text style={[styles.number, { color }]}>{readout.number}</Text>
      <Text numberOfLines={1} style={[styles.level, { color }]}>
        {readout.word}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: {
    width: 126,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  wideRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 8,
  },
  side: { flex: 1, minWidth: 0, justifyContent: 'center' },
  status: { width: 60, height: 54 },
  statusOption: { position: 'absolute', inset: 0, justifyContent: 'center', gap: 2 },
  number: {
    width: 60,
    fontFamily: theme.mono('700'),
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  level: { fontSize: 12, fontWeight: '800' },
  track: {
    width: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
    overflow: 'hidden',
  },
  fillClip: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, width: 58 },
  valueMarker: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
  },
  ticks: { position: 'absolute', inset: 9, justifyContent: 'space-evenly' },
  tick: {
    alignSelf: 'center',
    width: 12,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.mono.white, 0.4),
  },
})
