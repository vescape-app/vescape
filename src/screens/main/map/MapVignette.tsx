import { useEffect, type ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'

import { theme } from '@/constants/theme'
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

const DARK = theme.palette.slate.surfaceDeep
const RADIAL_POSITIONS = [0, 0.4, 0.68, 1]
const TOP_POSITIONS = [0, 0.7, 1]
const MAP_EDGE_POSITIONS = [0, 0.55, 1]
const HISTORY_TOP_POSITIONS = [0, 0.52, 1]
const HISTORY_BOTTOM_POSITIONS = [0, 0.5, 0.6, 1]

function mapEdgeVignetteSpace(mode: MainViewState) {
  if (mode === 'weather') {
    return {
      levels: [0.78, 0.36, 0],
      topEnd: 0.3,
      bottomStart: 0.7,
    }
  }

  if (mode === 'legalLimits') {
    return {
      levels: [0.6, 0.3, 0],
      topEnd: 0.18,
      bottomStart: 0.82,
    }
  }

  return {
    levels: [0.45, 0.18, 0],
    topEnd: 0.18,
    bottomStart: 0.82,
  }
}

function vignetteOpacity(level: number) {
  return theme.alpha(DARK, level as 0 | 0.12 | 0.3 | 0.6 | 0.85)
}

function VignetteLayer({
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
              colors={radial.map(vignetteOpacity)}
              positions={RADIAL_POSITIONS}
            />
          </Rect>
        </Group>
      ) : null}
      <Rect x={0} y={0} width={width} height={height * topEnd}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height * topEnd)}
          colors={top.map(vignetteOpacity)}
          positions={topPositions}
        />
      </Rect>
      {bottom != null && bottomStart != null ? (
        <Rect x={0} y={height * bottomStart} width={width} height={height * (1 - bottomStart)}>
          <LinearGradient
            start={vec(0, height)}
            end={vec(0, height * bottomStart)}
            colors={bottom.map(vignetteOpacity)}
            positions={bottomPositions}
          />
        </Rect>
      ) : null}
      {children}
    </Group>
  )
}

function AnimatedHistoryBottomGradient({
  width,
  height,
  bottomStart,
}: {
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
        colors={[0.85, 0.6, 0.3, 0].map(vignetteOpacity)}
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
  const { width, height } = useWindowDimensions()
  const mapSurfaceVisible = mode === 'map' || mode === 'weather' || mode === 'legalLimits'
  const mapEdgeSpace = mapEdgeVignetteSpace(mode === 'telemetry' ? 'map' : mode)
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
          width={width}
          height={height}
          opacity={homeLayerOpacity}
          radial={topOnly ? undefined : [0, 0.12, 0.3, 0.6]}
          top={[0.85, 0.3, 0]}
          topPositions={TOP_POSITIONS}
          topEnd={0.34}
          bottom={topOnly ? undefined : [0.85, 0.3, 0]}
          bottomPositions={TOP_POSITIONS}
          bottomStart={topOnly ? undefined : 0.66}
        />
        <VignetteLayer
          width={width}
          height={height}
          opacity={mapSurfaceLayerOpacity}
          top={mapEdgeSpace.levels}
          topPositions={MAP_EDGE_POSITIONS}
          topEnd={mapEdgeSpace.topEnd}
          bottom={topOnly ? undefined : mapEdgeSpace.levels}
          bottomPositions={MAP_EDGE_POSITIONS}
          bottomStart={topOnly ? undefined : mapEdgeSpace.bottomStart}
        />
        {!topOnly ? (
          <VignetteLayer
            width={width}
            height={height}
            opacity={historyLayerOpacity}
            radial={[0, 0.12, 0.3, 0.6]}
            top={[0.85, 0.6, 0]}
            topPositions={HISTORY_TOP_POSITIONS}
            topEnd={0.24}
          >
            <AnimatedHistoryBottomGradient
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
