import { PathIcon, TimerIcon, XIcon } from 'phosphor-react-native'
import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { DASH, fmtDistance, fmtRideDuration } from '@/helpers/format'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import {
  getMapTargetDisplayTitle,
  MapTargetIdentityIcon,
} from '@/modules/map-points/components/mapTargetSheetChrome'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

const EXPAND_DISTANCE = 92
const MAX_DRAG_EXPANSION = 56
const DRAG_RESISTANCE_DISTANCE = 84
const OPEN_THRESHOLD = 30

const COMPACT_EXITING = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -14 }] },
}).duration(120)

/** Compact proof that the accepted Navigation is still active after returning to the map. */
export function ActiveNavigationSheet({
  target,
  bottom,
  remainingDistanceMeters,
  durationSeconds,
  targetColor,
  targetTextColor,
  accentColor,
  cancelColor,
  cancelBackgroundColor,
  onOpen,
  onCancel,
}: {
  target: MapSelection
  bottom: number
  remainingDistanceMeters: number | null
  durationSeconds: number
  targetColor: string
  targetTextColor: string
  accentColor: string
  cancelColor: string
  cancelBackgroundColor: string
  onOpen: () => void
  onCancel: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const expansion = useSharedValue(0)
  const animatedContainerStyle = useAnimatedStyle(() => ({
    height: 82 + expansion.value,
    opacity: interpolate(expansion.value, [0, EXPAND_DISTANCE], [0.9, 1], 'clamp'),
  }))
  const expandGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(-8)
        .failOffsetX([-24, 24])
        .onUpdate((event) => {
          const pull = Math.max(0, -event.translationY)
          // Resistance starts immediately and strengthens continuously: the sheet always trails the
          // finger, then approaches its drag limit instead of hitting a sudden rubber-band point.
          expansion.value = MAX_DRAG_EXPANSION * (1 - Math.exp(-pull / DRAG_RESISTANCE_DISTANCE))
        })
        .onEnd((event) => {
          const shouldOpen = expansion.value >= OPEN_THRESHOLD || event.velocityY < -500
          if (shouldOpen) {
            expansion.value = withTiming(EXPAND_DISTANCE, { duration: 100 })
            scheduleOnRN(onOpen)
            return
          }
          expansion.value = withSpring(0, { damping: 16, stiffness: 190, mass: 0.72 })
        }),
    [expansion, onOpen],
  )

  const distanceLabel =
    remainingDistanceMeters != null ? fmtDistance(remainingDistanceMeters) : DASH

  return (
    <GestureDetector gesture={expandGesture}>
      <Animated.View exiting={COMPACT_EXITING} style={[styles.wrap, { bottom }]}>
        <View style={[styles.grabber, { backgroundColor: neutral.textSecondary }]} />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85),
              borderColor: theme.alpha(neutral.textSecondary, 0.3),
            },
            animatedContainerStyle,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open active navigation"
            onPress={onOpen}
            style={styles.content}
          >
            <MapTargetIdentityIcon
              target={target}
              fallbackColor={targetColor}
              fallbackTextColor={targetTextColor}
            />
            <View style={styles.titleBlock}>
              <Text numberOfLines={1} style={mapSheetStyles.mapTargetTitle}>
                {getMapTargetDisplayTitle(target)}
              </Text>
              <View style={styles.primaryFacts}>
                <PathIcon size={16} color={accentColor} weight="bold" />
                <Text style={[styles.fact, { color: accentColor }]}>{distanceLabel}</Text>
                {durationSeconds > 0 ? (
                  <>
                    <TimerIcon size={16} color={accentColor} weight="bold" />
                    <Text style={[styles.fact, { color: accentColor }]}>
                      {fmtRideDuration(durationSeconds)}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel navigation"
            onPress={(event) => {
              event.stopPropagation()
              onCancel()
            }}
            style={({ pressed }) => [
              styles.cancel,
              { borderColor: cancelColor, backgroundColor: cancelBackgroundColor },
              pressed && styles.pressed,
            ]}
          >
            <XIcon size={20} color={cancelColor} weight="bold" />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 45,
    gap: 7,
    alignItems: 'center',
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 2,
  },
  sheet: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  content: {
    height: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingRight: 66,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  primaryFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fact: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  cancel: {
    position: 'absolute',
    top: 17,
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.65,
  },
})
