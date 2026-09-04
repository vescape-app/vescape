import { useEffect, type ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'

import { theme, type ResolvedTheme } from '@/constants/theme'
import {
  Canvas,
  Group,
  LinearGradient,
  RadialGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia'
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { MainViewState } from '@/screens/main/mainViewState'
import { useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'
import { historyBottomGradientStart } from '@/screens/main/map/mapVignetteGeometry'

interface MapVignetteProps {
  mode: MainViewState
  panelHeight?: number
  /** Kept for call-site compatibility; Skia gradients have no global IDs. */
  idPrefix?: string
  topOnly?: boolean
  visible?: boolean
  fadeOutProgress?: SharedValue<number>
}

interface VignetteLayerProps {
  color: string
  levelScale: number
  width: number
  height: number
  opacity: { value: number }
  radial?: number[]
  top: number[]
  topPositions: number[]
  topEnd: number
  bottom?: number[]
  bottomPositions?: number[]
  bottomStart?: number
  children?: ReactNode
}

const RADIAL_POSITIONS = [0, 0.4, 0.68, 1]
/** Holds the wash almost to the end of the band, then drops off, instead of fading evenly. */
const TOP_POSITIONS = [0, 0.82, 1]
/** The telemetry gauge sits deeper into the screen than a short band reaches. */
const HOME_TOP_END = 0.44
const MAP_EDGE_POSITIONS = [0, 0.55, 1]
/** Holds the wash, then falls off sharply, instead of fading evenly across the band. */
const LIGHT_MAP_EDGE_POSITIONS = [0, 0.72, 1]
const HISTORY_TOP_POSITIONS = [0, 0.52, 1]
const HISTORY_BOTTOM_POSITIONS = [0, 0.5, 0.6, 1]

/**
 * Light mode holds the wash near full strength for most of the band and then drops off fast, and
 * reaches further into the screen: the readouts sit below the dark-mode edge band, and a near-white
 * wash over a light map needs the extra reach to lift them off the map detail.
 *
 * Weather mode carries the most text of any map surface at the bottom — the radar timeline and the
 * hourly strip — so its bottom band is stronger and starts higher than its top one.
 */
function mapEdgeVignetteSpace(mode: MainViewState, resolvedTheme: ResolvedTheme) {
  const light = resolvedTheme === 'light'

  if (mode === 'weather') {
    return {
      levels: [0.78, 0.36, 0],
      positions: light ? LIGHT_MAP_EDGE_POSITIONS : MAP_EDGE_POSITIONS,
      topEnd: 0.3,
      bottomLevels: [0.95, 0.55, 0],
      bottomStart: 0.6,
    }
  }

  if (mode === 'legalLimits') {
    return {
      levels: [0.6, 0.3, 0],
      positions: light ? LIGHT_MAP_EDGE_POSITIONS : MAP_EDGE_POSITIONS,
      topEnd: light ? 0.3 : 0.18,
      bottomStart: light ? 0.7 : 0.82,
    }
  }

  return {
    levels: [0.45, 0.18, 0],
    positions: light ? LIGHT_MAP_EDGE_POSITIONS : MAP_EDGE_POSITIONS,
    topEnd: light ? 0.3 : 0.18,
    bottomStart: light ? 0.7 : 0.82,
  }
}

/**
 * The light wash is near-white over a light map, so the same level lifts far less contrast than the
 * navy wash does on dark. Light mode scales every level up to keep the numbers readable.
 */
const LIGHT_LEVEL_SCALE = 1.5

function vignetteOpacity(color: string, level: number, levelScale: number) {
  return theme.alpha(color, Math.min(1, level * levelScale) as 0 | 0.12 | 0.3 | 0.6 | 0.85)
}

function VignetteLayer({
  color,
  levelScale,
  width,
  height,
  opacity,
  radial,
  top,
  topPositions,
  topEnd,
  bottom,
  bottomPositions,
  bottomStart,
  children,
}: VignetteLayerProps) {
  const radialRadius = width * 0.68
  const radialScaleY = (height * 0.62) / radialRadius
  const radialBaseHeight = height / radialScaleY
  const radialBaseTop = (height - radialBaseHeight) / 2

  return (
    <Group opacity={opacity}>
      {radial != null ? (
        <Group origin={vec(width / 2, height / 2)} transform={[{ scaleY: radialScaleY }]}>
          <Rect x={0} y={radialBaseTop} width={width} height={radialBaseHeight}>
            <RadialGradient
              c={vec(width / 2, height / 2)}
              r={radialRadius}
              colors={radial.map((level) => vignetteOpacity(color, level, levelScale))}
              positions={RADIAL_POSITIONS}
            />
          </Rect>
        </Group>
      ) : null}
      <Rect x={0} y={0} width={width} height={height * topEnd}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height * topEnd)}
          colors={top.map((level) => vignetteOpacity(color, level, levelScale))}
          positions={topPositions}
        />
      </Rect>
      {bottom != null && bottomStart != null ? (
        <Rect x={0} y={height * bottomStart} width={width} height={height * (1 - bottomStart)}>
          <LinearGradient
            start={vec(0, height)}
            end={vec(0, height * bottomStart)}
            colors={bottom.map((level) => vignetteOpacity(color, level, levelScale))}
            positions={bottomPositions}
          />
        </Rect>
      ) : null}
      {children}
    </Group>
  )
}

function AnimatedHistoryBottomGradient({
  color,
  levelScale,
  width,
  height,
  bottomStart,
}: {
  color: string
  levelScale: number
  width: number
  height: number
  bottomStart: SharedValue<number>
}) {
  const y = useDerivedValue(() => height * bottomStart.value)
  const gradientEnd = useDerivedValue(() => vec(0, height * bottomStart.value))
  const gradientHeight = useDerivedValue(() => height * (1 - bottomStart.value))

  return (
    <Rect x={0} y={y} width={width} height={gradientHeight}>
      <LinearGradient
        start={vec(0, height)}
        end={gradientEnd}
        colors={[0.85, 0.6, 0.3, 0].map((level) => vignetteOpacity(color, level, levelScale))}
        positions={HISTORY_BOTTOM_POSITIONS}
      />
    </Rect>
  )
}

export function MapVignette({
  mode,
  panelHeight = 0,
  topOnly = false,
  visible = true,
  fadeOutProgress,
}: MapVignetteProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const levelScale = resolvedTheme === 'light' ? LIGHT_LEVEL_SCALE : 1
  const { width, height } = useWindowDimensions()
  const mapSurfaceVisible = mode === 'map' || mode === 'weather' || mode === 'legalLimits'
  const mapEdgeSpace = mapEdgeVignetteSpace(mode === 'telemetry' ? 'map' : mode, resolvedTheme)
  const homeOpacity = useSharedValue(visible && mode === 'telemetry' ? 1 : 0)
  const mapSurfaceOpacity = useSharedValue(visible && mapSurfaceVisible ? 1 : 0)
  const historyBottomStart = historyBottomGradientStart(panelHeight, height)
  const historyBottomStartValue = useSharedValue(historyBottomStart)
  const homeLayerOpacity = useDerivedValue(
    () => homeOpacity.value * (1 - (fadeOutProgress?.value ?? 0)),
  )
  const mapSurfaceLayerOpacity = useDerivedValue(() =>
    Math.min(1, mapSurfaceOpacity.value + homeOpacity.value * (fadeOutProgress?.value ?? 0)),
  )
  const historyLayerOpacity = useDerivedValue(() =>
    withTiming(visible && mode === 'history' ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    }),
  )

  useEffect(() => {
    const transition = { duration: 280, easing: Easing.out(Easing.cubic) }
    homeOpacity.value = withTiming(visible && mode === 'telemetry' ? 1 : 0, transition)
    mapSurfaceOpacity.value = withTiming(visible && mapSurfaceVisible ? 1 : 0, transition)
  }, [homeOpacity, mapSurfaceOpacity, mapSurfaceVisible, mode, visible])

  useEffect(() => {
    historyBottomStartValue.value = withTiming(historyBottomStart, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    })
  }, [historyBottomStart, historyBottomStartValue])

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Canvas style={styles.canvas}>
        <VignetteLayer
          color={neutral.surfaceDeep}
          levelScale={levelScale}
          width={width}
          height={height}
          opacity={homeLayerOpacity}
          radial={topOnly ? undefined : [0, 0.12, 0.3, 0.6]}
          top={[0.85, 0.3, 0]}
          topPositions={TOP_POSITIONS}
          topEnd={HOME_TOP_END}
          bottom={topOnly ? undefined : [0.85, 0.3, 0]}
          bottomPositions={TOP_POSITIONS}
          bottomStart={topOnly ? undefined : 0.66}
        />
        <VignetteLayer
          color={neutral.surfaceDeep}
          levelScale={levelScale}
          width={width}
          height={height}
          opacity={mapSurfaceLayerOpacity}
          top={mapEdgeSpace.levels}
          topPositions={mapEdgeSpace.positions}
          topEnd={mapEdgeSpace.topEnd}
          bottom={topOnly ? undefined : (mapEdgeSpace.bottomLevels ?? mapEdgeSpace.levels)}
          bottomPositions={mapEdgeSpace.positions}
          bottomStart={topOnly ? undefined : mapEdgeSpace.bottomStart}
        />
        {!topOnly ? (
          <VignetteLayer
            color={neutral.surfaceDeep}
            levelScale={levelScale}
            width={width}
            height={height}
            opacity={historyLayerOpacity}
            radial={[0, 0.12, 0.3, 0.6]}
            top={[0.85, 0.6, 0]}
            topPositions={HISTORY_TOP_POSITIONS}
            topEnd={0.24}
          >
            <AnimatedHistoryBottomGradient
              color={neutral.surfaceDeep}
              levelScale={levelScale}
              width={width}
              height={height}
              bottomStart={historyBottomStartValue}
            />
          </VignetteLayer>
        ) : null}
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    zIndex: 4,
  },
  canvas: StyleSheet.absoluteFill,
})
