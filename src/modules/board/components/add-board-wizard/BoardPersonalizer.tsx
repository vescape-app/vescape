/* eslint-disable react-hooks/immutability */
import * as Haptics from 'expo-haptics'
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { personalizationColorOptions, theme } from '@/constants/theme'
import { RAILS, type RailId } from '@/modules/board/lib/railPresets'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

export type { RailId } from '@/modules/board/lib/railPresets'

export const RAIL_COLORS = personalizationColorOptions

export type RailColorId = (typeof RAIL_COLORS)[number]['id']

const ITEM_WIDTH = 150
const ITEM_GAP = 0
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
  railId,
  railColorId,
  muted = false,
}: {
  railId: RailId
  railColorId: RailColorId
  muted?: boolean
}) {
  const pitch = useSharedValue<number | null>(0)
  const roll = useSharedValue<number | null>(28)
  useEffect(() => {
    if (!muted) {
      roll.value = 28
      roll.value = withRepeat(withTiming(388, { duration: 9000, easing: Easing.linear }), -1, false)
      pitch.value = withRepeat(
        withTiming(12, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      )
    } else {
      cancelAnimation(roll)
      cancelAnimation(pitch)
      roll.value = 28
      pitch.value = 0
    }
    return () => {
      cancelAnimation(roll)
      cancelAnimation(pitch)
    }
  }, [muted, pitch, roll])
  return (
    <BoardAttitudeIndicator
      pitch={pitch}
      roll={roll}
      connected
      muted={muted}
      railId={railId}
      railColorId={railColorId}
      size={112}
    />
  )
}

export function BoardStyleIcon({ railId, railColorId }: { railId?: string; railColorId?: string }) {
  const rail = RAILS.find((option) => option.id === railId) ?? RAILS[DEFAULT_INDEX]
  const color =
    RAIL_COLORS.find((option) => option.id === railColorId)?.value ?? RAIL_COLORS[0].value

  return (
    <Svg width={58} height={32} viewBox="0 0 208 70">
      <Circle cx="104" cy="32" r="30" fill="none" stroke={color} strokeWidth="2" />
      <Circle cx="104" cy="32" r="15" fill="none" stroke={color} strokeWidth="2" />
      <Path
        d={rail.path}
        fill="none"
        stroke={color}
        strokeWidth="3"
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

  const selectRenderedIndex = useCallback(
    (rawIndex: number) => {
      const index = loopIndex(rawIndex)
      if (index !== selectedIndex) {
        liveIndex.value = index
        tick()
        selectIndex(index)
      }
      translateX.value = withSpring(-rawIndex * ITEM_SPACING, SNAP, (finished) => {
        if (finished) translateX.value = -(RAIL_COUNT + index) * ITEM_SPACING
      })
    },
    [liveIndex, selectIndex, selectedIndex, tick, translateX],
  )

  const selectAdjacent = useCallback(
    (direction: -1 | 1) => {
      const renderedIndex = Math.round(-translateX.value / ITEM_SPACING)
      selectRenderedIndex(renderedIndex + direction)
    },
    [selectRenderedIndex, translateX],
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
      <Text style={styles.label}>Board style</Text>

      <View style={styles.selector}>
        <View style={styles.selectorHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous board style"
            hitSlop={10}
            onPress={() => selectAdjacent(-1)}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <CaretLeftIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
          </Pressable>
          <Text style={styles.railName}>
            {RAILS[selectedIndex]?.label ?? RAILS[DEFAULT_INDEX].label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next board style"
            hitSlop={10}
            onPress={() => selectAdjacent(1)}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <CaretRightIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
          </Pressable>
        </View>
        <View>
          <GestureDetector gesture={gesture}>
            <View
              style={styles.viewport}
              onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
              accessibilityLabel="Board style selector"
            >
              <Animated.View
                style={[styles.railRow, { left: viewportWidth / 2 - ITEM_WIDTH / 2 }, rowStyle]}
              >
                {LOOPED_RAILS.map((rail, index) => (
                  <Pressable
                    key={`${rail.id}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${rail.label}`}
                    onPress={() => selectRenderedIndex(index)}
                    style={({ pressed }) => [styles.railItem, pressed && styles.railPressed]}
                  >
                    <RailOutline
                      railId={rail.id}
                      railColorId={railColorId}
                      muted={loopIndex(index) !== selectedIndex}
                    />
                  </Pressable>
                ))}
              </Animated.View>
            </View>
          </GestureDetector>
        </View>
      </View>

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
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  railName: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    minWidth: 100,
  },
  selector: { gap: 6 },
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  arrow: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewport: { height: 118, overflow: 'hidden' },
  railRow: { position: 'absolute', top: 3, flexDirection: 'row', gap: ITEM_GAP },
  railItem: { width: ITEM_WIDTH, alignItems: 'center' },
  railPressed: { opacity: 0.65 },
  colors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
  },
  colorTarget: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: theme.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatch: { width: 22, height: 22, borderRadius: 11 },
  pressed: { opacity: 0.7 },
})
