import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

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

/**
 * Heavy gradient: the dashboard/telemetry face. Same weight across modes so the home face reads
 * consistently; fades out as the rider enters the map.
 */
function homeGradient(color: string, topOnly: boolean, light: boolean): string {
  const edge = 0.85
  const middle = light ? 0.3 : 0.3
  const radialEdge = light ? 0.34 : 0.34
  const layers = [
    `linear-gradient(to bottom, ${rgba(color, edge)} 0%, ${rgba(color, middle)} 48%, ${rgba(color, 0)} 66%)`,
  ]
  if (!topOnly) {
    layers.push(
      `linear-gradient(to top, ${rgba(color, edge)} 0%, ${rgba(color, middle)} 54%, ${rgba(color, 0)} 58%)`,
      `radial-gradient(ellipse at center, ${rgba(color, light ? 0.04 : 0.02)} 34%, ${rgba(color, radialEdge)} 100%)`,
    )
  }
  return layers.join(', ')
}

/**
 * Lighter edge vignette shown over the map/weather/legal-limits face. Fades in as the home
 * gradient fades out, restoring the dashboard → map crossfade.
 */
function mapEdgeGradient({
  mode,
  color,
  topOnly,
  light,
}: {
  mode: MainViewState
  color: string
  topOnly: boolean
  light: boolean
}): string {
  const edge = mode === 'weather' ? 0.78 : mode === 'legalLimits' ? 0.6 : 0.45
  const middle = mode === 'weather' ? 0.36 : mode === 'legalLimits' ? 0.3 : 0.18
  const radialEdge = light ? 0.16 : 0.12
  const topEnd = mode === 'weather' ? 30 : 18
  const bottomStart = mode === 'weather' ? 70 : 82
  const layers = [
    `linear-gradient(to bottom, ${rgba(color, edge)} 0%, ${rgba(color, middle)} ${topEnd}%, ${rgba(color, 0)} 66%)`,
  ]
  if (!topOnly) {
    layers.push(
      `linear-gradient(to top, ${rgba(color, edge)} 0%, ${rgba(color, middle)} ${100 - bottomStart}%, ${rgba(color, 0)} 58%)`,
      `radial-gradient(ellipse at center, ${rgba(color, light ? 0.03 : 0.02)} 34%, ${rgba(color, radialEdge)} 100%)`,
    )
  }
  return layers.join(', ')
}

/**
 * Readability wash over the map. Fabric gradients avoid the Android Skia shader crash that forced
 * the previous implementation off. Light appearance fades into a white canvas; dark appearance
 * keeps the established deep-edge treatment. Two stacked layers crossfade on `mode` change — the
 * heavy home gradient fades out as the lighter map-edge gradient fades in — restoring the
 * dashboard → map transition.
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
  const light = appearance === 'light'
  const color = light ? neutral.bg : neutral.surfaceDeep
  const isHome = mode === 'telemetry'
  const isMapFace = mode === 'map' || mode === 'weather' || mode === 'legalLimits'

  const homePresence = useSharedValue(visible && (isHome || mode === 'history') ? 1 : 0)
  const mapPresence = useSharedValue(visible && isMapFace ? 1 : 0)

  useEffect(() => {
    const transition = { duration: 280, easing: Easing.out(Easing.cubic) }
    homePresence.value = withTiming(visible && (isHome || mode === 'history') ? 1 : 0, transition)
    mapPresence.value = withTiming(visible && isMapFace ? 1 : 0, transition)
  }, [homePresence, isMapFace, isHome, mapPresence, mode, visible])

  const homeOpacity = useDerivedValue(
    () => homePresence.value * (1 - (fadeOutProgress?.value ?? 0)),
  )
  const mapOpacity = useDerivedValue(() => mapPresence.value * (1 - (fadeOutProgress?.value ?? 0)))

  const homeBg = useMemo(() => homeGradient(color, topOnly, light), [color, light, topOnly])
  const mapBg = useMemo(
    () => mapEdgeGradient({ mode, color, topOnly, light }),
    [color, light, mode, topOnly],
  )

  const homeStyle = useAnimatedStyle(() => ({ opacity: homeOpacity.value }))
  const mapStyle = useAnimatedStyle(() => ({ opacity: mapOpacity.value }))

  if (mode === 'history') {
    // A single gradient layer: dark at the top and bottom edges, clear through the middle.
    // One layer means no two-half overlap and no center seam.
    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, homeStyle]}>
        <View
          style={[
            styles.gradient,
            {
              experimental_backgroundImage: `linear-gradient(to bottom, ${rgba(color, 0.85)} 0%, ${rgba(color, 0.3)} 30%, ${rgba(color, 0)} 45%, ${rgba(color, 0)} 55%, ${rgba(color, 0.3)} 70%, ${rgba(color, 0.85)} 100%)`,
            },
          ]}
        />
      </Animated.View>
    )
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap]}>
      <Animated.View style={[styles.layer, homeStyle]}>
        <View style={[styles.gradient, { experimental_backgroundImage: homeBg }]} />
      </Animated.View>
      <Animated.View style={[styles.layer, mapStyle]}>
        <View style={[styles.gradient, { experimental_backgroundImage: mapBg }]} />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill },
  layer: { ...StyleSheet.absoluteFill },
  gradient: { flex: 1 },
})
