/* eslint-disable react-hooks/immutability */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const WIDTH = 58
const HEIGHT = 26
const BORDER = 1.5
const PAD = 3
const THUMB = 18
const TRAVEL = WIDTH - 2 * (BORDER + PAD) - THUMB
const SPRING = { damping: 17, stiffness: 260, mass: 0.7 } as const
const SPIN_DURATION_MS = 850

const SwitchAccentContext = createContext<ThemeColor | undefined>(undefined)

/**
 * Lends every switch below it an accent, so a tinted row does not have to repeat its colour on the
 * control it already states in its icon. An explicit `accent` on the switch still wins.
 */
export function SwitchAccentProvider({
  accent,
  children,
}: {
  accent: ThemeColor
  children: ReactNode
}) {
  return <SwitchAccentContext.Provider value={accent}>{children}</SwitchAccentContext.Provider>
}

export interface SwitchProps {
  /** `null` while the owner has not said yet — the thumb rests centred and the caption clears. */
  value: boolean | null
  onValueChange: (value: boolean) => void
  /** A write is in flight: the thumb centres and spins there until the owner answers. */
  pending?: boolean
  disabled?: boolean
  /** Tint of the on state. Defaults to the surrounding `SwitchAccentProvider`, then to sky. */
  accent?: ThemeColor
  accessibilityLabel?: string
  testID?: string
}

/**
 * The app's switch. An outlined capsule whose thumb rides between three rest positions — off, on,
 * and centre — so a control backed by the board can say "I do not know yet" without lying about
 * which way it is set, and can spin in place while a write is in flight.
 *
 * Tap or drag; a drag that does not cross the middle springs back. A disabled switch drops its
 * accent and dashes its outline rather than dimming its on colour: a switch that still reads on
 * while refusing taps looks broken, not locked.
 */
export function Switch({
  value,
  onValueChange,
  pending,
  disabled,
  accent,
  accessibilityLabel,
  testID,
}: SwitchProps) {
  const inheritedAccent = useContext(SwitchAccentContext)
  const neutral = useResolvedNeutralColors()
  const tint = useResolvedColor(accent ?? inheritedAccent ?? theme.palette.sky.color)
  const tintSoft = theme.alpha(tint, 0.6)
  const tintWash = theme.alpha(tint, 0.12)
  const tintClear = theme.alpha(tint, 0)

  const target = pending || value == null ? 0.5 : value ? 1 : 0
  const progress = useSharedValue(target)
  const pressed = useSharedValue(0)
  const spin = useSharedValue(0)
  const dragging = useSharedValue(false)
  const dragStart = useSharedValue(0)
  const interactive = !disabled && !pending

  useEffect(() => {
    if (dragging.value) return
    progress.value = withSpring(target, SPRING)
  }, [target, dragging, progress])

  useEffect(() => {
    if (!pending) {
      cancelAnimation(spin)
      spin.value = 0
      return
    }
    spin.value = 0
    spin.value = withRepeat(
      withTiming(1, { duration: SPIN_DURATION_MS, easing: Easing.linear }),
      -1,
    )
    return () => cancelAnimation(spin)
  }, [pending, spin])

  const commit = useCallback(
    (next: boolean) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onValueChange(next)
    },
    [onValueChange],
  )

  const gesture = useMemo(() => {
    const on = value === true

    const tap = Gesture.Tap()
      .enabled(interactive)
      .onBegin(() => {
        pressed.value = withTiming(1, { duration: 90 })
      })
      .onEnd(() => {
        scheduleOnRN(commit, !on)
      })
      .onFinalize(() => {
        pressed.value = withTiming(0, { duration: 160 })
      })

    const pan = Gesture.Pan()
      .enabled(interactive)
      .activeOffsetX([-5, 5])
      .onBegin(() => {
        pressed.value = withTiming(1, { duration: 90 })
        dragStart.value = progress.value
      })
      .onUpdate((event) => {
        dragging.value = true
        progress.value = Math.max(0, Math.min(1, dragStart.value + event.translationX / TRAVEL))
      })
      .onEnd((event) => {
        dragging.value = false
        const next = progress.value + (event.velocityX / TRAVEL) * 0.08 > 0.5
        if (next === on) progress.value = withSpring(next ? 1 : 0, SPRING)
        else scheduleOnRN(commit, next)
      })
      .onFinalize(() => {
        dragging.value = false
        pressed.value = withTiming(0, { duration: 160 })
      })

    return Gesture.Race(pan, tap)
  }, [commit, dragStart, dragging, interactive, pressed, progress, value])

  const trackStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [neutral.border, neutral.textMuted, tintSoft],
    ),
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [tintClear, tintClear, tintWash],
    ),
  }))

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }, { scale: 1 + pressed.value * 0.1 }],
    borderColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [neutral.textMuted, neutral.textSecondary, tint],
    ),
  }))

  const dotStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [neutral.textMuted, neutral.textSecondary, tint],
    ),
    opacity: interpolate(Math.abs(progress.value - 0.5), [0, 0.25], [0, 1]),
  }))

  const onCaptionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.7, 1], [0, 1], 'clamp'),
    color: tint,
  }))

  const offCaptionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3], [1, 0], 'clamp'),
    color: neutral.textMuted,
  }))

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
    opacity: interpolate(Math.abs(progress.value - 0.5), [0, 0.2], [1, 0]),
  }))

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.hitbox, disabled && styles.disabled]}
        accessibilityRole="switch"
        accessibilityState={{ checked: value === true, disabled: Boolean(disabled) }}
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        {...(testID ? { testID } : {})}
      >
        <Animated.View style={[styles.track, disabled ? styles.trackDisabled : null, trackStyle]}>
          <Animated.Text style={[styles.caption, styles.captionOn, onCaptionStyle]}>
            ON
          </Animated.Text>
          <Animated.Text style={[styles.caption, styles.captionOff, offCaptionStyle]}>
            OFF
          </Animated.Text>
          <Animated.View style={[styles.thumb, thumbStyle]}>
            {pending ? (
              <Animated.View style={[styles.spinner, { borderColor: tint }, spinnerStyle]} />
            ) : (
              <Animated.View style={[styles.dot, dotStyle]} />
            )}
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  hitbox: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  disabled: {
    opacity: 0.45,
  },
  track: {
    width: WIDTH,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    borderWidth: BORDER,
    padding: PAD,
    justifyContent: 'center',
  },
  trackDisabled: {
    borderStyle: 'dashed',
  },
  caption: {
    position: 'absolute',
    fontFamily: theme.font('800'),
    fontSize: 9,
    letterSpacing: 0.6,
  },
  captionOn: {
    left: 8,
  },
  captionOff: {
    right: 6,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  spinner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderTopColor: 'transparent',
  },
})
