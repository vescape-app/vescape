import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  BroadcastIcon,
  CalendarBlankIcon,
  EyeSlashIcon,
  InfinityIcon,
  PathIcon,
} from 'phosphor-react-native'
import * as Haptics from 'expo-haptics'
import Svg, { Circle, G, Line, Path } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Text } from '@/components/base/Text'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { useColoredControlSurface } from '@/components/controls/coloredControlSurface'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  PUBLIC_RIDE_ARC,
  publicRideIndexAt,
  publicRideSector,
} from '@/modules/group-ride/lib/publicRideArc'
import { PUBLIC_MODES, type PublicMode } from './fixtures'

const AnimatedLine = Animated.createAnimatedComponent(Line)

const ICONS = [EyeSlashIcon, PathIcon, CalendarBlankIcon, InfinityIcon]
const SECTORS = PUBLIC_MODES.map((_, index) => publicRideSector(index))

/** Presentation only: the owner decides what selecting a sharing duration does. */
export function PublicRideSelector({
  value,
  onValueChange,
}: {
  value: PublicMode
  onValueChange: (mode: PublicMode) => void
}) {
  const neutral = useResolvedNeutralColors()
  const surface = useColoredControlSurface(theme.palette.groupRide.color)
  const [width, setWidth] = useState(320)
  const scale = width / PUBLIC_RIDE_ARC.width
  const selected = PUBLIC_MODES.findIndex((option) => option.value === value)
  const committed = useSharedValue(selected)
  const detent = useSharedValue(selected)
  const angle = useSharedValue(-67.5 + selected * 45)
  const live = value !== 'off'

  useEffect(() => {
    committed.set(selected)
    detent.set(selected)
    angle.set(withTiming(-67.5 + selected * 45, { duration: 150 }))
  }, [angle, committed, detent, selected])

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
      angle.set(withTiming(-67.5 + next * 45, { duration: 100 }))
      scheduleOnRN(select, next)
    }
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => update(event.x, event.y))
      .onUpdate((event) => update(event.x, event.y))
  }, [angle, detent, scale, select])
  const pointerProps = useAnimatedProps(() => {
    const radians = (angle.get() * Math.PI) / 180
    const { cx, cy, knobRadius } = PUBLIC_RIDE_ARC
    return {
      x1: cx + Math.sin(radians) * (knobRadius - 5),
      y1: cy - Math.cos(radians) * (knobRadius - 5),
      x2: cx + Math.sin(radians) * (knobRadius - 20),
      y2: cy - Math.cos(radians) * (knobRadius - 20),
    }
  })

  return (
    <CanvasWidget
      icon={BroadcastIcon}
      title="Public ride"
      accent={theme.palette.groupRide.color}
      surface="secondary"
      action={
        <View style={styles.badge} accessibilityLiveRegion="polite">
          <View
            style={[
              styles.dot,
              { backgroundColor: live ? theme.palette.groupRide.color : neutral.textSecondary },
            ]}
          />
          <Text
            style={[
              styles.status,
              { color: live ? theme.palette.groupRide.color : neutral.textSecondary },
            ]}
          >
            {live ? 'LIVE' : 'PRIVATE'}
          </Text>
        </View>
      }
    >
      <View style={styles.content}>
        <GestureDetector gesture={gesture}>
          <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={styles.arc}
            testID="public-ride-selector"
            accessibilityRole="radiogroup"
            accessibilityLabel="Public ride duration"
          >
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${PUBLIC_RIDE_ARC.width} ${PUBLIC_RIDE_ARC.height}`}
              style={StyleSheet.absoluteFill}
            >
              {SECTORS.map((sector, index) => (
                <Path
                  key={PUBLIC_MODES[index].value}
                  d={sector.path}
                  fill={
                    selected === index
                      ? index === 0
                        ? surface.unselected
                        : surface.selected
                      : surface.unselected
                  }
                  stroke={
                    selected === index
                      ? index === 0
                        ? neutral.textSecondary
                        : surface.tint
                      : neutral.border
                  }
                  strokeWidth={1}
                />
              ))}
              {/* The dial and sectors share one viewport, centre and scale. */}
              <Circle
                cx={PUBLIC_RIDE_ARC.cx}
                cy={PUBLIC_RIDE_ARC.cy}
                r={PUBLIC_RIDE_ARC.knobRadius}
                fill={live ? surface.selected : neutral.surface}
                stroke={live ? surface.tint : neutral.textSecondary}
                strokeWidth={1}
              />
              <G transform={`translate(${PUBLIC_RIDE_ARC.cx - 12} ${PUBLIC_RIDE_ARC.cy - 12})`}>
                <BroadcastIcon size={24} color={live ? surface.tint : neutral.textSecondary} />
              </G>
              <AnimatedLine
                animatedProps={pointerProps}
                stroke={live ? surface.tint : neutral.textSecondary}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            {PUBLIC_MODES.map((option, index) => {
              const Icon = ICONS[index]
              const active = selected === index
              const color =
                active && index > 0
                  ? surface.tint
                  : surface.onNavy
                    ? theme.control.textMuted
                    : neutral.textSecondary
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
                  <Icon size={18} color={color} />
                  <Text style={[styles.label, { color, fontWeight: active ? '700' : '500' }]}>
                    {option.title}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </GestureDetector>
        <Text
          style={[styles.description, { color: neutral.textSecondary }]}
          accessibilityLiveRegion="polite"
        >
          {PUBLIC_MODES[selected].subtitle}
        </Text>
      </View>
    </CanvasWidget>
  )
}

const styles = StyleSheet.create({
  content: { marginTop: -8, gap: 0 },
  arc: { width: '100%', maxWidth: 340, aspectRatio: 320 / 188, alignSelf: 'center' },
  choice: {
    position: 'absolute',
    width: 70,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: { fontSize: 11, textAlign: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  status: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  description: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
})
