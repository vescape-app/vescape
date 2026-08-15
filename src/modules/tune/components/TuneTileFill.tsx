import { useCallback, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Canvas, LinearGradient, Rect, RoundedRect, vec } from '@shopify/react-native-skia'

import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedControlColors } from '@/hooks/useTheme'

interface TuneTileFillProps {
  fraction: number | null
  color?: string
  fillHeightRatio?: number
}

const LINE_THICKNESS = 2
const MARKER_WIDTH = 3
const MARKER_Y_OFFSET = 1
const TRACK_INSET = 0

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function TuneTileFill({ fraction, color, fillHeightRatio = 0.42 }: TuneTileFillProps) {
  const control = useResolvedControlColors()
  const resolvedColor = useResolvedColor(color ?? theme.palette.sky.color)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [])

  const normalized = fraction == null ? 0 : clamp01(fraction)
  const fillHeight = size.height * clamp01(fillHeightRatio)
  const fillY = size.height - fillHeight
  const trackX = TRACK_INSET
  const trackWidth = Math.max(0, size.width - TRACK_INSET * 2)
  const fillWidth = trackWidth * normalized
  const lineY = Math.max(0, size.height - LINE_THICKNESS - TRACK_INSET)
  const markerHeight = fillHeight
  const markerX = Math.min(
    trackX + trackWidth - MARKER_WIDTH,
    Math.max(trackX, trackX + fillWidth - MARKER_WIDTH / 2),
  )

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size.width > 0 && size.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {fillWidth > 0 ? (
            <Rect x={trackX} y={fillY} width={fillWidth} height={fillHeight}>
              <LinearGradient
                start={vec(0, fillY)}
                end={vec(0, size.height)}
                colors={[
                  theme.alpha(resolvedColor, 0),
                  theme.alpha(resolvedColor, 0.12),
                  theme.alpha(resolvedColor, 0.12),
                  theme.alpha(resolvedColor, 0.3),
                ]}
                positions={[0, 0.35, 0.75, 1]}
              />
            </Rect>
          ) : null}
          <RoundedRect
            x={trackX}
            y={lineY}
            width={trackWidth}
            height={LINE_THICKNESS}
            r={LINE_THICKNESS / 2}
            color={control.divider}
          />
          {fillWidth > 0 ? (
            <RoundedRect
              x={trackX}
              y={lineY}
              width={fillWidth}
              height={LINE_THICKNESS}
              r={LINE_THICKNESS / 2}
              color={resolvedColor}
            />
          ) : null}
          {fraction != null ? (
            <Rect
              x={markerX}
              y={lineY - markerHeight + MARKER_Y_OFFSET}
              width={MARKER_WIDTH}
              height={markerHeight + LINE_THICKNESS - MARKER_Y_OFFSET}
              color={resolvedColor}
            />
          ) : null}
        </Canvas>
      ) : null}
    </View>
  )
}
