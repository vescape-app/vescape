import { useEffect, useMemo } from 'react'
import { Canvas, Path, Skia } from '@shopify/react-native-skia'
import type { Icon } from 'phosphor-react-native'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { interaction, theme } from '@/constants/theme'

const SIZES = { sm: 38, md: 50, lg: 54 } as const
const ICON_SIZES = { sm: 18, md: 21, lg: 22 } as const
const RING_STROKE = 2.5

/** Determinate ring hugging the button's border, filling clockwise from the top. */
function ProgressRing({ dim, color, progress }: { dim: number; color: string; progress: number }) {
  const path = useMemo(() => {
    const inset = RING_STROKE / 2
    const p = Skia.Path.Make()
    p.addArc({ x: inset, y: inset, width: dim - RING_STROKE, height: dim - RING_STROKE }, -90, 360)
    return p
  }, [dim])
  const end = Math.min(1, Math.max(0, progress))

  return (
    <Canvas pointerEvents="none" style={[styles.ring, { width: dim, height: dim }]}>
      <Path path={path} style="stroke" strokeWidth={RING_STROKE} color={theme.alpha(color, 0.3)} />
      <Path
        path={path}
        style="stroke"
        strokeWidth={RING_STROKE}
        strokeCap="round"
        color={color}
        end={end}
      />
    </Canvas>
  )
}

/**
 * An alternate identity the button wears while something important is happening behind it — the
 * Social button becoming a live Group Ride, the Settings gear becoming an available update or a
 * running backup. The resting icon stays the component's own; a takeover only overrides.
 */
export interface IconButtonTakeover {
  /** Replaces the resting icon. Omit to keep it and only recolor. */
  icon?: Icon
  /** Replaces the icon and border color. */
  accent?: string
  /** 0–1 determinate ring drawn around the button. Omit for indeterminate work. */
  progress?: number
}

interface IconButtonProps {
  icon: Icon
  onPress: () => void
  /** Alternate icon/accent/progress for an active background state. Null when resting. */
  takeover?: IconButtonTakeover | null
  onLongPress?: () => void
  size?: keyof typeof SIZES
  disabled?: boolean
  destructive?: boolean
  /** Override the icon + border colour to signal an active state. */
  accent?: string
  /** Show a small pulsing badge dot in this colour (e.g. nearby Group Rides). */
  dot?: string
  loading?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
  accessibilityLabel?: string
}

export function IconButton({
  icon: RestingIcon,
  onPress,
  takeover,
  onLongPress,
  size = 'sm',
  disabled = false,
  destructive = false,
  accent,
  dot,
  loading = false,
  style,
  testID,
  accessibilityLabel,
}: IconButtonProps) {
  const isDisabled = disabled || loading
  const dim = SIZES[size]
  const iconSize = ICON_SIZES[size]
  const Icon = takeover?.icon ?? RestingIcon
  // A takeover outranks `accent`: it is the state the Rider needs to see right now.
  const activeAccent = takeover?.accent ?? accent
  const iconColor = destructive ? theme.status.error.text : (activeAccent ?? theme.control.icon)
  const borderColor = destructive
    ? theme.status.error.border
    : (activeAccent ?? theme.control.border)
  const progress = takeover?.progress

  const pulse = useSharedValue(0)
  useEffect(() => {
    if (!dot) return
    pulse.value = 0
    pulse.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
  }, [dot, pulse])
  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
    transform: [{ scale: 0.85 + pulse.value * 0.35 }],
  }))

  return (
    <Pressable
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        { width: dim, height: dim, borderRadius: dim / 2, borderColor },
        isDisabled && styles.disabled,
        pressed && !isDisabled && { opacity: interaction.pressedOpacity },
        style,
      ]}
      android_ripple={{ ...interaction.rippleBorderless, radius: dim / 2 }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Icon size={iconSize} color={iconColor} weight="bold" />
      )}
      {progress != null && !loading ? (
        <ProgressRing dim={dim} color={iconColor} progress={progress} />
      ) : null}
      {dot && !loading ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.dot, { backgroundColor: dot }, dotStyle]}
        />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.control.background,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.35,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.control.background,
  },
})
