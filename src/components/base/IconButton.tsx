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

import { useColoredAction, useResolvedColor } from '@/hooks/useTheme'
import { interaction, theme, type ThemeColor } from '@/constants/theme'

const SIZES = { sm: 38, md: 50, lg: 54 } as const
const ICON_SIZES = { sm: 18, md: 21, lg: 22 } as const
const RING_STROKE = 2.5

function ProgressRing({
  dim,
  color,
  progress,
}: {
  dim: number
  color: ThemeColor
  progress: number
}) {
  const ringColor = useResolvedColor(color)
  const path = useMemo(() => {
    const inset = RING_STROKE / 2
    const p = Skia.Path.Make()
    p.addArc({ x: inset, y: inset, width: dim - RING_STROKE, height: dim - RING_STROKE }, -90, 360)
    return p
  }, [dim])
  const end = Math.min(1, Math.max(0, progress))

  return (
    <Canvas pointerEvents="none" style={[styles.ring, { width: dim, height: dim }]}>
      <Path
        path={path}
        style="stroke"
        strokeWidth={RING_STROKE}
        color={theme.alpha(ringColor, 0.3)}
      />
      <Path
        path={path}
        style="stroke"
        strokeWidth={RING_STROKE}
        strokeCap="round"
        color={ringColor}
        end={end}
      />
    </Canvas>
  )
}

export interface IconButtonTakeover {
  icon?: Icon
  accent?: ThemeColor
  progress?: number
}

export type IconButtonVariant = 'soft' | 'solid' | 'outline' | 'ghost'

interface IconButtonProps {
  icon: Icon
  onPress: () => void
  takeover?: IconButtonTakeover | null
  onLongPress?: () => void
  size?: keyof typeof SIZES
  variant?: IconButtonVariant
  disabled?: boolean
  destructive?: boolean
  accent?: ThemeColor
  iconColor?: ThemeColor
  dot?: ThemeColor
  loading?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
  accessibilityLabel?: string
}

function getBackground(
  variant: IconButtonVariant,
  accent: ThemeColor | undefined,
  coloredSurface: ThemeColor,
): ThemeColor {
  if (variant === 'outline' || variant === 'ghost') return theme.alpha(theme.palette.mono.black, 0)
  if (!accent) return theme.control.background
  return variant === 'solid' ? theme.alpha(accent, 0.3) : coloredSurface
}

export function IconButton({
  icon: RestingIcon,
  onPress,
  takeover,
  onLongPress,
  size = 'sm',
  variant = 'soft',
  disabled = false,
  destructive = false,
  accent,
  iconColor,
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
  const activeAccent = takeover?.accent ?? accent
  const resolvedIconColor = destructive
    ? theme.palette.red.light
    : (activeAccent ?? iconColor ?? theme.control.icon)
  const borderColor = destructive ? theme.palette.red.light : (activeAccent ?? theme.control.border)
  const coloredAccent = destructive ? theme.palette.red.light : activeAccent
  const coloredSurface = useColoredAction(coloredAccent ?? theme.control.background)
  const background = getBackground(variant, coloredAccent, coloredSurface)
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
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          borderColor,
          backgroundColor: background,
        },
        variant === 'ghost' && styles.ghost,
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
        <ActivityIndicator size="small" color={resolvedIconColor} />
      ) : (
        <Icon size={iconSize} color={resolvedIconColor} weight="bold" />
      )}
      {progress != null && !loading ? (
        <ProgressRing dim={dim} color={resolvedIconColor} progress={progress} />
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
    borderWidth: 1,
  },
  ghost: {
    borderWidth: 0,
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
