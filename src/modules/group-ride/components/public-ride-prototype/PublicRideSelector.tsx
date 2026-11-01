import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  BroadcastIcon,
  CalendarBlankIcon,
  PowerIcon,
  InfinityIcon,
  NavigationArrowIcon,
} from 'phosphor-react-native'
import * as Haptics from 'expo-haptics'
import Svg, { G, Path } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Text } from '@/components/base/Text'
import { blend, theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  PUBLIC_RIDE_ARC,
  publicRideIndexAt,
  publicRideSector,
} from '@/modules/group-ride/lib/publicRideArc'
import { PUBLIC_MODES, type PublicMode } from './fixtures'

const BROADCAST_Y = PUBLIC_RIDE_ARC.cy - 18

const ICONS = [PowerIcon, NavigationArrowIcon, CalendarBlankIcon, InfinityIcon]
const SECTORS = PUBLIC_MODES.map((_, index) => publicRideSector(index))

/** Presentation only: the owner decides what selecting a sharing duration does. */
export function PublicRideSelector({
  value,
  onValueChange,
  profileAction,
}: {
  value: PublicMode
  profileAction?: ReactNode
  onValueChange: (mode: PublicMode) => void
}) {
  const neutral = useResolvedNeutralColors()
  const accent = useResolvedColor(theme.palette.groupRide.color)
  const activeFill = blend(neutral.surfaceDeep, accent, 0.12)
  const [width, setWidth] = useState<number>(PUBLIC_RIDE_ARC.width)
  const scale = width / PUBLIC_RIDE_ARC.width
  const selected = PUBLIC_MODES.findIndex((option) => option.value === value)
  const committed = useSharedValue(selected)
  const detent = useSharedValue(selected)
  const wave = useSharedValue(1)
  const previous = useRef(value)
  const live = value !== 'off'

  useEffect(() => {
    committed.set(selected)
    detent.set(selected)
  }, [committed, detent, selected])

  useEffect(() => {
    cancelAnimation(wave)
    if (previous.current !== value && value !== 'off') {
      wave.set(0)
      wave.set(withRepeat(withTiming(1, { duration: 700 }), 2, false))
    } else {
      wave.set(1)
    }
    previous.current = value
    return () => cancelAnimation(wave)
  }, [value, wave])

  const waveStyle = useAnimatedStyle(() => ({
    opacity: (1 - wave.get()) * 0.65,
    transform: [{ scale: 0.7 + wave.get() * 1.3 }],
  }))

  const select = useCallback(
    (index: number) => {
      if (index < 0 || index === committed.get()) return
      committed.set(index)
      // A distinct stop at Private; light detents while scrubbing between public durations.
      void Haptics.impactAsync(
        index === 0 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft,
      )
      onValueChange(PUBLIC_MODES[index].value)
    },
    [committed, onValueChange],
  )

  const gesture = useMemo(() => {
    const update = (x: number, y: number) => {
      'worklet'
      const next = publicRideIndexAt(x / scale, y / scale)
      if (next < 0 || next === detent.get()) return
      detent.set(next)
      scheduleOnRN(select, next)
    }
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => update(event.x, event.y))
      .onUpdate((event) => update(event.x, event.y))
  }, [detent, scale, select])

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <BroadcastIcon size={22} color={accent} style={styles.headerIcon} />
        <View style={styles.heading}>
          <Text style={[styles.title, { color: neutral.textPrimary }]}>Public ride</Text>
          <Text style={[styles.intro, { color: neutral.textSecondary }]}>Share your location</Text>
        </View>
        {profileAction ?? (
          <Text style={[styles.status, { color: live ? accent : neutral.textSecondary }]}>
            {live ? 'LIVE' : 'PRIVATE'}
          </Text>
        )}
      </View>
      <View style={styles.content}>
        <GestureDetector gesture={gesture}>
          <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={[styles.arc, { height: PUBLIC_RIDE_ARC.height * scale }]}
            testID="public-ride-selector"
            accessibilityRole="radiogroup"
            accessibilityLabel="Public ride duration"
          >
            <Svg
              width={width}
              height={PUBLIC_RIDE_ARC.height * scale}
              viewBox={`0 0 ${PUBLIC_RIDE_ARC.width} ${PUBLIC_RIDE_ARC.height}`}
              style={StyleSheet.absoluteFill}
            >
              {SECTORS.map((sector, index) => (
                <Path
                  key={PUBLIC_MODES[index].value}
                  d={sector.path}
                  fill={selected === index && index > 0 ? activeFill : neutral.surfaceDeep}
                  stroke={
                    selected === index
                      ? index === 0
                        ? neutral.textSecondary
                        : accent
                      : neutral.border
                  }
                  strokeWidth={1}
                />
              ))}
              <G transform={`translate(${PUBLIC_RIDE_ARC.cx - 9} ${BROADCAST_Y - 9})`}>
                <BroadcastIcon size={18} color={live ? accent : neutral.textSecondary} />
              </G>
            </Svg>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.wave,
                {
                  left: PUBLIC_RIDE_ARC.cx * scale - 15,
                  top: BROADCAST_Y * scale - 15,
                  borderColor: accent,
                },
                waveStyle,
              ]}
            />
            {PUBLIC_MODES.map((option, index) => {
              const Icon = ICONS[index]
              const active = selected === index
              const color = active && index > 0 ? accent : neutral.textSecondary
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${option.title}. ${option.subtitle}`}
                  onPress={() => select(index)}
                  style={[
                    styles.choice,
                    {
                      left: SECTORS[index].label.x * scale - 35,
                      top: SECTORS[index].label.y * scale - 24,
                    },
                  ]}
                >
                  <Icon size={20} color={color} />
                  <Text style={[styles.label, { color, fontWeight: active ? '700' : '500' }]}>
                    {option.title}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </GestureDetector>
        <Text
          style={[styles.description, { color: neutral.textPrimary }]}
          accessibilityLiveRegion="polite"
        >
          {PUBLIC_MODES[selected].subtitle}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  headerIcon: { marginTop: 3 },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 17, fontWeight: '700' },
  content: { gap: 0 },
  intro: { fontSize: 11, lineHeight: 16, maxWidth: 210 },
  arc: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
  },
  wave: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 1 },
  choice: {
    position: 'absolute',
    width: 70,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: { fontSize: 12, textAlign: 'center' },
  status: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  description: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: -18,
    marginBottom: 10,
  },
})
