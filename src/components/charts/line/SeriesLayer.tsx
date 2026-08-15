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
import { resolveAdaptiveColor } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors, useThemeStore } from '@/hooks/useTheme'

const LINE_WIDTH = 2
const DOT_DIAMETER = 3.5
const HEAD_RADIUS = 3
/** A ring in the plot background, so the head reads as a marker rather than a bump in the line. */
/** Parked off-canvas rather than hidden: a series with no samples costs nothing to skip. */
const OFFSCREEN = -1_000

export interface SeriesLayerProps {
  paths: SeriesPaths
  yRange: ChartYRange
  color: string
  /** Colour by value. Overrides `color` where the two would disagree. */
  ramp?: ChartColorRamp
  /** Mark the last sample — the live head, or where a finished ride ended. */
  showHead?: boolean
  plot: ChartPlotBox
  camera: SharedValue<ChartCamera>
  dataKey: string
}

/**
 * One series, drawn by transforming a prebuilt path rather than reprojecting points.
 *
 * Each level of detail is a Skia path in data space, built once when the data arrives. A frame
 * picks the level whose buckets are about a pixel wide and applies the viewport as a matrix, so
 * the cost of a zoom frame depends on what is visible rather than on how long the ride was —
 * and no sample data is ever copied to the UI thread.
 */
export function SeriesLayer({
  paths,
  yRange,
  color,
  ramp,
  showHead = false,
  plot,
  camera,
  dataKey,
}: SeriesLayerProps) {
  // React Compiler memoises hook results by its own rules, which do not know that a derived
  // value must be rebuilt when its declared dependencies change.
  'use no memo'
  const resolvedColor = useResolvedColor(color)
  const neutral = useResolvedNeutralColors()
  const appearance = useThemeStore((state) => state.resolvedTheme)

  // Fixed y means a fixed gradient: this survives every pan and zoom untouched.
  const gradient = useMemo(
    () =>
      ramp
        ? resolveRampGradient(
            {
              ...ramp,
              stops: ramp.stops.map((stop) => ({
                ...stop,
                color: resolveAdaptiveColor(stop.color, appearance) as string,
              })),
            },
            yRange,
            plot.height,
          )
        : null,
    [appearance, plot.height, ramp, yRange],
  )

  /**
   * A frame is painted from the element tree as it stands when a shared value changes. Changing
   * the data changes both the path (a shared value) and the gradient (an ordinary prop), and the
   * repaint the path schedules can land before React has committed the new gradient — leaving
   * the new line painted with the previous shader until the next touch repaints it. Bumping this
   * after the commit asks for one more frame, with both halves in place.
   */
  const repaint = useSharedValue(0)
  useEffect(() => {
    repaint.value += 1
  }, [gradient, repaint])

  const linePath = useDerivedValue(() => {
    // Reading the counter is what subscribes this mapper to the nudge; it never goes negative.
    if (repaint.value < 0 || paths.isEmpty || plot.width <= 0) return Skia.Path.Make()
    const viewport = viewportFor(camera.value, dataKey, paths.domainStartMs, paths.domainEndMs)
    const level = pickLevel(paths.bucketMs, msPerPixel(viewport, plot.width))
    const source = level < 0 ? paths.raw : paths.levels[level]
    const matrix = viewportMatrix(viewport, paths.domainStartMs, yRange, plot.width, plot.height)
    // Tiles are indexed in seconds from the domain start, the same space the paths live in.
    const fromSec = (viewport.startMs - paths.domainStartMs) / 1000
    const toSec = (viewport.endMs - paths.domainStartMs) / 1000
    return composeVisibleTiles(source, fromSec, toSec, matrix)
  }, [dataKey, paths, plot.height, plot.width, yRange])

  // Marking samples reuses the line that is already projected, so nothing extra is stored per
  // dataset and only the points actually on screen are read.
  const dotPath = useDerivedValue(() => {
    if (paths.isEmpty || plot.width <= 0) return Skia.Path.Make()
    const viewport = viewportFor(camera.value, dataKey, paths.domainStartMs, paths.domainEndMs)
    if (!shouldMarkSamples(paths.sampleMs, msPerPixel(viewport, plot.width))) {
      return Skia.Path.Make()
    }
    return visiblePointDots(linePath.value, plot.width)
  }, [dataKey, paths, plot.height, plot.width, yRange])

  // The head only moves when the camera or the data does, so it is one mapper that sleeps through
  // a scrub — and it is parked off-canvas rather than hidden when there is nothing to mark.
  const head = paths.head
  const headTransform = useDerivedValue(() => {
    if (head == null || plot.width <= 0) return [{ translateX: OFFSCREEN }, { translateY: 0 }]
    const viewport = viewportFor(camera.value, dataKey, paths.domainStartMs, paths.domainEndMs)
    return [
      { translateX: projectX(paths.domainStartMs + head.sec * 1000, viewport, plot.width) },
      { translateY: projectY(head.value, yRange, plot.height) },
    ]
  }, [camera, dataKey, head, paths, plot.height, plot.width, yRange])

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
