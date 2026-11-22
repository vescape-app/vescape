import { useEffect, useMemo } from 'react'
import { Circle, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia'
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { resolveRampGradient } from '@/components/charts/line/colorRamp'

import {
  msPerPixel,
  pickLevel,
  projectX,
  projectY,
  viewportFor,
  viewportMatrix,
} from '@/components/charts/line/projection'
import {
  composeVisibleTiles,
  shouldMarkSamples,
  visiblePointDots,
  type SeriesPaths,
} from '@/components/charts/line/seriesPaths'
import type {
  ChartCamera,
  ChartColorRamp,
  ChartPlotBox,
  ChartYRange,
} from '@/components/charts/line/types'
import { resolveAdaptiveColor, type ThemeColor } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'

const LINE_WIDTH = 2
const DOT_DIAMETER = 3.5
const HEAD_RADIUS = 3
const OFFSCREEN = -1_000

export interface SeriesLayerProps {
  paths: SeriesPaths
  yRange: ChartYRange
  color: ThemeColor
  ramp?: ChartColorRamp
  showHead?: boolean
  plot: ChartPlotBox
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
}

export function SeriesLayer({
  paths,
  yRange,
  color,
  ramp,
  showHead = false,
  plot,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
}: SeriesLayerProps) {
  'use no memo'
  const resolvedColor = useResolvedColor(color)
  const neutral = useResolvedNeutralColors()
  const appearance = useThemeStore((state) => state.resolvedTheme)

  const gradient = useMemo(
    () =>
      ramp
        ? resolveRampGradient(
            {
              ...ramp,
              stops: ramp.stops.map((stop) => ({
                ...stop,
                color: resolveAdaptiveColor(stop.color, appearance),
              })),
            },
            yRange,
            plot.height,
          )
        : null,
    [appearance, plot.height, ramp, yRange],
  )

  const repaint = useSharedValue(0)
  useEffect(() => {
    repaint.value += 1
  }, [gradient, repaint])

  const linePath = useDerivedValue(() => {
    if (repaint.value < 0 || paths.isEmpty || plot.width <= 0) return Skia.Path.Make()
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const level = pickLevel(paths.bucketMs, msPerPixel(viewport, plot.width))
    const source = level < 0 ? paths.raw : paths.levels[level]
    const matrix = viewportMatrix(viewport, paths.domainStartMs, yRange, plot.width, plot.height)
    const fromSec = (viewport.startMs - paths.domainStartMs) / 1000
    const toSec = (viewport.endMs - paths.domainStartMs) / 1000
    return composeVisibleTiles(source, fromSec, toSec, matrix)
  }, [dataKey, domainStartMs, domainEndMs, paths, plot.height, plot.width, yRange])

  const dotPath = useDerivedValue(() => {
    if (paths.isEmpty || plot.width <= 0) return Skia.Path.Make()
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    if (!shouldMarkSamples(paths.sampleMs, msPerPixel(viewport, plot.width))) {
      return Skia.Path.Make()
    }
    return visiblePointDots(linePath.value, plot.width)
  }, [dataKey, domainStartMs, domainEndMs, paths, plot.height, plot.width, yRange])

  const head = paths.head
  const headTransform = useDerivedValue(() => {
    if (head == null || plot.width <= 0) return [{ translateX: OFFSCREEN }, { translateY: 0 }]
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    return [
      { translateX: projectX(paths.domainStartMs + head.sec * 1000, viewport, plot.width) },
      { translateY: projectY(head.value, yRange, plot.height) },
    ]
  }, [camera, dataKey, domainStartMs, domainEndMs, head, paths, plot.height, plot.width, yRange])

  const shader = gradient ? (
    <LinearGradient
      start={vec(0, 0)}
      end={vec(0, plot.height)}
      colors={gradient.colors}
      positions={gradient.positions}
    />
  ) : null

  return (
    <>
      <Path
        path={linePath}
        color={resolvedColor}
        style="stroke"
        strokeWidth={LINE_WIDTH}
        strokeCap="round"
        strokeJoin="round"
      >
        {shader}
      </Path>
      <Path
        path={dotPath}
        color={resolvedColor}
        style="stroke"
        strokeWidth={DOT_DIAMETER}
        strokeCap="round"
      >
        {shader}
      </Path>
      {showHead && (
        <Group transform={headTransform}>
          <Circle cx={0} cy={0} r={HEAD_RADIUS} color={resolvedColor} />
          <Circle cx={0} cy={0} r={HEAD_RADIUS} color={neutral.bg} style="stroke" strokeWidth={1} />
        </Group>
      )}
    </>
  )
}
