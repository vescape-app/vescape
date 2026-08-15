import { useMemo } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'
import type { MainViewState } from '@/screens/main/mainViewState'

interface MapVignetteProps {
  mode: MainViewState
  panelHeight?: number
  idPrefix?: string
  topOnly?: boolean
  visible?: boolean
  fadeOutProgress?: SharedValue<number>
}

function rgba(hex: string, alpha: number): string {
  const value = hex.slice(1)
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function gradientForMode({
  mode,
  color,
  topOnly,
  historyBottomStart,
  light,
}: {
  mode: MainViewState
  color: string
  topOnly: boolean
  historyBottomStart: number
  light: boolean
}): string {
  const edge = mode === 'weather' ? 0.92 : mode === 'legalLimits' ? 0.82 : 0.72
  const middle = light ? 0.18 : 0.12
  const radialEdge = light ? 0.46 : 0.34
  const topEnd = mode === 'history' ? 38 : mode === 'telemetry' ? 48 : 30
  const bottomStart = mode === 'history' ? historyBottomStart : mode === 'telemetry' ? 54 : 72
  const layers = [
    `linear-gradient(to bottom, ${rgba(color, edge)} 0%, ${rgba(color, middle)} ${topEnd}%, ${rgba(color, 0)} 66%)`,
  ]

  if (!topOnly) {
    layers.push(
      `linear-gradient(to top, ${rgba(color, edge)} 0%, ${rgba(color, middle)} ${100 - bottomStart}%, ${rgba(color, 0)} 58%)`,
      `radial-gradient(ellipse at center, ${rgba(color, light ? 0.04 : 0.02)} 34%, ${rgba(color, radialEdge)} 100%)`,
    )
  }

  return layers.join(', ')
}

/**
 * Readability wash over the map. Fabric gradients avoid the Android Skia shader crash that forced
 * the previous implementation off. Light appearance fades into a white canvas; dark appearance
 * keeps the established deep-edge treatment.
 */
export function MapVignette({
  mode,
  panelHeight = 0,
  topOnly = false,
  visible = true,
  fadeOutProgress,
}: MapVignetteProps) {
  const neutral = useResolvedNeutralColors()
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const { height } = useWindowDimensions()
  const historyBottomStart = Math.round(
    100 * Math.max(0.18, Math.min(0.72, 1 - panelHeight / Math.max(1, height) - 0.2)),
  )
  const backgroundImage = useMemo(
    () =>
      gradientForMode({
        mode,
        color: appearance === 'light' ? neutral.bg : neutral.surfaceDeep,
        topOnly,
        historyBottomStart,
        light: appearance === 'light',
      }),
    [appearance, historyBottomStart, mode, neutral.bg, neutral.surfaceDeep, topOnly],
  )
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visible ? 1 - (fadeOutProgress?.value ?? 0) : 0,
  }))

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, animatedStyle]}>
      <View style={[styles.gradient, { experimental_backgroundImage: backgroundImage }]} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill },
  gradient: { flex: 1 },
})
