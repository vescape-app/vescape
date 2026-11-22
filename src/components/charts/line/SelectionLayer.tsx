import { Group, LinearGradient, Rect, RoundedRect, vec } from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { projectX, viewportFor } from '@/components/charts/line/projection'
import { toChartMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera, ChartTimeRange } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'

const HANDLE_WIDTH = 3

export interface SelectionLayerProps {
  selection: SharedValue<ChartTimeRange | null>
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotX: number
  plotWidth: number
  top: number
  bottom: number
  timeline: ChartTimeline | null
}

export function SelectionLayer({
  selection,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotX,
  plotWidth,
  top,
  bottom,
  timeline,
}: SelectionLayerProps) {
  'use no memo'
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const edgeColor = accents.amber.color
  const dimColor = theme.alpha(neutral.bg, 0.6)
  const glowColors = useMemo(
    () => [
      theme.alpha(edgeColor, 0.3),
      theme.alpha(edgeColor, 0.12),
      theme.alpha(edgeColor, 0),
      theme.alpha(edgeColor, 0.12),
      theme.alpha(edgeColor, 0.3),
    ],
    [edgeColor],
  )
  const height = bottom - top

  const edges = useDerivedValue(() => {
    const range = selection.value
    if (range == null) return { left: 0, right: 0, active: false }
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const clamp = (x: number) => Math.min(Math.max(x, 0), plotWidth)
    return {
      left: clamp(projectX(toChartMs(range.startMs, timeline), viewport, plotWidth)),
      right: clamp(projectX(toChartMs(range.endMs, timeline), viewport, plotWidth)),
      active: true,
    }
  }, [camera, dataKey, domainEndMs, domainStartMs, plotWidth, timeline])

  const opacity = useDerivedValue(() => (edges.value.active ? 1 : 0), [])
  const leftDim = useDerivedValue(() => [{ translateX: edges.value.left - plotWidth }], [plotWidth])
  const rightDim = useDerivedValue(() => [{ translateX: edges.value.right }], [])
  const glow = useDerivedValue(
    () => [
      { translateX: edges.value.left },
      { scaleX: Math.max(edges.value.right - edges.value.left, 0.001) },
    ],
    [],
  )
  const startHandle = useDerivedValue(
    () => [{ translateX: edges.value.left - HANDLE_WIDTH / 2 }],
    [],
  )
  const endHandle = useDerivedValue(
    () => [{ translateX: edges.value.right - HANDLE_WIDTH / 2 }],
    [],
  )

  return (
    <Group opacity={opacity} clip={{ x: plotX, y: top, width: plotWidth, height }}>
      <Group transform={[{ translateX: plotX }]}>
        <Group transform={leftDim}>
          <Rect x={0} y={top} width={plotWidth} height={height} color={dimColor} />
        </Group>
        <Group transform={rightDim}>
          <Rect x={0} y={top} width={plotWidth} height={height} color={dimColor} />
        </Group>

        <Group transform={glow}>
          <Rect x={0} y={top} width={1} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(1, 0)}
              colors={glowColors}
              positions={[0, 0.15, 0.5, 0.85, 1]}
            />
          </Rect>
        </Group>

        <Group transform={startHandle}>
          <RoundedRect
            x={0}
            y={top}
            width={HANDLE_WIDTH}
            height={height}
            r={HANDLE_WIDTH / 2}
            color={edgeColor}
          />
        </Group>
        <Group transform={endHandle}>
          <RoundedRect
            x={0}
            y={top}
            width={HANDLE_WIDTH}
            height={height}
            r={HANDLE_WIDTH / 2}
            color={edgeColor}
          />
        </Group>
      </Group>
    </Group>
  )
}
