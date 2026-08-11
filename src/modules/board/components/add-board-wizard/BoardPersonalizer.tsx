/* eslint-disable react-hooks/immutability */
import * as Haptics from 'expo-haptics'
import { useCallback, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { personalizationColorOptions, theme } from '@/constants/theme'

type RailPoint = readonly [x: number, y: number]

/** Builds a faceted rail around a centerline. Slanted end faces represent the bumper interface. */
function railPath(points: readonly RailPoint[], thickness = 10): string {
  const first = points[0]!
  const last = points[points.length - 1]!
  const half = thickness / 2
  const cap = 8
  const inner = points.slice(1, -1)
  const top = inner.map(([x, y]) => `L${x} ${y - half}`).join(' ')
  const bottom = [...inner]
    .reverse()
    .map(([x, y]) => `L${x} ${y + half}`)
    .join(' ')

  return `M${first[0]} ${first[1] - half} ${top} L${last[0]} ${last[1] - half} L${last[0] - cap} ${last[1] + half} ${bottom} L${first[0] + cap} ${first[1] + half} Z`
}

export const RAILS = [
  {
    id: 'adv',
    label: 'Floatwheel ADV',
    path: railPath([
      [14, 25],
      [76, 30],
      [94, 32],
      [114, 32],
      [132, 30],
      [194, 25],
    ]),
  },
  {
    id: 'cyber-xl',
    label: 'CyberRails XL 10°',
    path: railPath([
      [14, 25],
      [76, 31],
      [94, 32],
      [114, 32],
      [132, 31],
      [194, 25],
    ]),
  },
  {
    id: 'cyber',
    label: 'CyberRails 7°',
    path: railPath([
      [14, 27],
      [76, 31],
      [94, 32],
      [114, 32],
      [132, 31],
      [194, 27],
    ]),
  },
  {
    id: 'wtf-extended-steep',
    label: 'WTF Extended Steep & Deep · 5°/5°',
    path: railPath([
      [4, 25],
      [72, 31],
      [92, 32],
      [116, 32],
      [136, 31],
      [204, 25],
    ]),
  },
  {
    id: 'wtf-extended',
    label: 'WTF Extended',
    path: railPath([
      [4, 27],
      [72, 31],
      [92, 32],
      [116, 32],
      [136, 31],
      [204, 27],
    ]),
  },
  {
    id: 'wtf-steep',
    label: 'WTF Steep & Deep · 5°/5°',
    path: railPath([
      [14, 25],
      [74, 31],
      [92, 32],
      [116, 32],
      [134, 31],
      [194, 25],
    ]),
  },
  {
    id: 'wtf',
    label: 'WTF Standard',
    path: railPath([
      [14, 27],
      [74, 31],
      [92, 32],
      [116, 32],
      [134, 31],
      [194, 27],
    ]),
  },
  {
    id: 'tail',
    label: 'Tail Rails',
    path: railPath([
      [14, 32],
      [124, 32],
      [194, 24],
    ]),
  },
  {
    id: 'thunder',
    label: 'Fungineers Thunder · 3°/3°',
    path: railPath([
      [14, 28],
      [76, 31],
      [94, 32],
      [114, 32],
      [132, 31],
      [194, 28],
    ]),
  },
  {
    id: 'x11',
    label: 'Fungineers X11',
    path: railPath([
      [14, 24],
      [70, 29],
      [89, 34],
      [104, 32],
      [119, 34],
      [138, 29],
      [194, 24],
    ]),
  },
  {
    id: 'x10',
    label: 'Fungineers X10 · 7°/3°',
    path: railPath([
      [4, 22],
      [70, 30],
      [92, 32],
      [116, 32],
      [138, 30],
      [204, 28],
    ]),
  },
  {
    id: 'x7',
    label: 'Fungineers X7 · 4.2°/4.2°',
    path: railPath([
      [14, 26],
      [72, 30],
      [90, 34],
      [104, 32],
      [118, 34],
      [136, 30],
      [194, 26],
    ]),
  },
  {
    id: 'xr',
    label: 'XR Stock · straight',
    path: railPath(
      [
        [14, 32],
        [194, 32],
      ],
      9,
    ),
  },
  {
    id: 'gt',
    label: 'GT Stock · straight',
    path: railPath(
      [
        [14, 32],
        [194, 32],
      ],
      12,
    ),
  },
  {
    id: 'pint-x',
    label: 'Pint X Stock · straight',
    path: railPath(
      [
        [20, 32],
        [188, 32],
      ],
      11,
    ),
  },
  {
    id: 'pint',
    label: 'Pint Stock · straight',
    path: railPath(
      [
        [25, 32],
        [183, 32],
      ],
      10,
    ),
  },
] as const

export type RailId = (typeof RAILS)[number]['id']

export const RAIL_COLORS = personalizationColorOptions

export type RailColorId = (typeof RAIL_COLORS)[number]['id']

const ITEM_WIDTH = 108
const WHEEL_WIDTH = 168
const ITEM_GAP = 2
const ITEM_SPACING = ITEM_WIDTH + ITEM_GAP
const DEFAULT_INDEX = RAILS.findIndex((rail) => rail.id === 'xr')
const RAIL_COUNT = RAILS.length
const LOOPED_RAILS = [...RAILS, ...RAILS, ...RAILS]
const SNAP = { damping: 28, stiffness: 260, mass: 1.45 }

function loopIndex(index: number): number {
  'worklet'
  return ((index % RAIL_COUNT) + RAIL_COUNT) % RAIL_COUNT
}

interface BoardPersonalizerProps {
  railId: RailId
  railColorId: RailColorId
  onRailChange: (railId: RailId) => void
  onRailColorChange: (colorId: RailColorId) => void
}

function RailOutline({
  path,
  color,
  muted = false,
}: {
  path: string
  color: string
  muted?: boolean
}) {
  return (
    <Svg width={ITEM_WIDTH} height={70} viewBox="0 0 208 70">
      <Path
        d={path}
        fill="none"
        stroke={muted ? theme.palette.slate.textDim : color}
        strokeWidth={muted ? 1 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function BoardPersonalizer({
  railId,
  railColorId,
  onRailChange,
  onRailColorChange,
}: BoardPersonalizerProps) {
  'use no memo'
  const selectedIndex = Math.max(
    0,
    RAILS.findIndex((rail) => rail.id === railId),
  )
  const selectedColor =
    RAIL_COLORS.find((color) => color.id === railColorId)?.value ?? RAIL_COLORS[0].value
  const [viewportWidth, setViewportWidth] = useState(0)
  const translateX = useSharedValue(-(RAIL_COUNT + selectedIndex) * ITEM_SPACING)
  const dragStartX = useSharedValue(0)
  const liveIndex = useSharedValue(selectedIndex)

  const tick = useCallback(() => {
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (Platform.OS === 'android') {
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick)
    }
  }, [])

  const selectIndex = useCallback(
    (index: number) => {
      const rail = RAILS[index]
      if (rail && rail.id !== railId) onRailChange(rail.id)
    },
    [onRailChange, railId],
  )

  const updateIndex = useCallback(
    (rawIndex: number) => {
      'worklet'
      const index = loopIndex(rawIndex)
      if (index === liveIndex.value) return
      liveIndex.value = index
      scheduleOnRN(tick)
      scheduleOnRN(selectIndex, index)
    },
    [liveIndex, selectIndex, tick],
  )

  const snapToIndex = useCallback(
    (rawIndex: number) => {
      'worklet'
      const index = loopIndex(rawIndex)
      updateIndex(index)
      translateX.value = withSpring(-rawIndex * ITEM_SPACING, SNAP, (finished) => {
        if (finished) translateX.value = -(RAIL_COUNT + index) * ITEM_SPACING
      })
    },
    [translateX, updateIndex],
  )

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .onStart(() => {
          cancelAnimation(translateX)
          dragStartX.value = translateX.value
        })
        .onUpdate((event) => {
          let raw = dragStartX.value + event.translationX * 0.78
          const renderedIndex = -raw / ITEM_SPACING
          if (renderedIndex < RAIL_COUNT * 0.5) {
            raw -= RAIL_COUNT * ITEM_SPACING
            dragStartX.value -= RAIL_COUNT * ITEM_SPACING
          } else if (renderedIndex > RAIL_COUNT * 2.5) {
            raw += RAIL_COUNT * ITEM_SPACING
            dragStartX.value += RAIL_COUNT * ITEM_SPACING
          }
          translateX.value = raw
          updateIndex(Math.round(-translateX.value / ITEM_SPACING))
        })
        .onEnd((event) => {
          const projected = translateX.value + event.velocityX * 0.065
          snapToIndex(Math.round(-projected / ITEM_SPACING))
        }),
    [dragStartX, snapToIndex, translateX, updateIndex],
  )

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }))

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Rails</Text>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.viewport}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          accessibilityLabel="Rail selector"
        >
          <View pointerEvents="none" style={styles.fixedWheel}>
            <Svg width={WHEEL_WIDTH} height={70} viewBox="0 0 208 70">
              <Circle
                cx="104"
                cy="32"
                r="27"
                fill="none"
                stroke={theme.alpha(selectedColor, 0.4)}
                strokeWidth="1"
              />
            </Svg>
          </View>
          <Animated.View
            style={[styles.railRow, { left: viewportWidth / 2 - ITEM_WIDTH / 2 }, rowStyle]}
          >
            {LOOPED_RAILS.map((rail, index) => (
              <View key={`${rail.id}-${index}`} style={styles.railItem}>
                <RailOutline
                  path={rail.path}
                  color={selectedColor}
                  muted={loopIndex(index) !== selectedIndex}
                />
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      <Text style={styles.railName}>
        {RAILS[selectedIndex]?.label ?? RAILS[DEFAULT_INDEX].label}
      </Text>

      <View style={styles.colors} accessibilityRole="radiogroup">
        {RAIL_COLORS.map((color) => {
          const selected = color.id === railColorId
          return (
            <Pressable
              key={color.id}
              onPress={() => {
                onRailColorChange(color.id)
                void Haptics.selectionAsync()
              }}
              accessibilityRole="radio"
              accessibilityLabel={`${color.id} rails`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.colorTarget,
                selected && { borderColor: selectedColor },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.colorSwatch, { backgroundColor: color.value }]} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  railName: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewport: { height: 86, overflow: 'hidden' },
  fixedWheel: {
    position: 'absolute',
    top: 4,
    left: '50%',
    marginLeft: -WHEEL_WIDTH / 2,
    zIndex: 0,
  },
  railRow: { position: 'absolute', top: 4, zIndex: 1, flexDirection: 'row', gap: ITEM_GAP },
  railItem: { width: ITEM_WIDTH, alignItems: 'center' },
  colors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  colorTarget: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatch: { width: 22, height: 22, borderRadius: 11 },
  pressed: { opacity: 0.7 },
})
