import { Path, Skia } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import {
  msPerPixel,
  pickLevel,
  viewportFor,
  viewportMatrix,
} from '@/components/charts/line/projection'
import {
  composeVisibleTiles,
  shouldMarkSamples,
  visiblePointDots,
  type SeriesPaths,
} from '@/components/charts/line/seriesPaths'
import type { ChartCamera, ChartPlotBox, ChartYRange } from '@/components/charts/line/types'

const LINE_WIDTH = 2
const DOT_DIAMETER = 3.5

export interface SeriesLayerProps {
  paths: SeriesPaths
  yRange: ChartYRange
  color: string
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
export function SeriesLayer({ paths, yRange, color, plot, camera, dataKey }: SeriesLayerProps) {
  // React Compiler memoises hook results by its own rules, which do not know that a derived
  // value must be rebuilt when its declared dependencies change.
  'use no memo'

  const linePath = useDerivedValue(() => {
    if (paths.isEmpty || plot.width <= 0) return Skia.Path.Make()
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

  return (
    <>
      <Path
        path={linePath}
        color={color}
        style="stroke"
        strokeWidth={LINE_WIDTH}
        strokeCap="round"
        strokeJoin="round"
      />
      <Path
        path={dotPath}
        color={color}
        style="stroke"
        strokeWidth={DOT_DIAMETER}
        strokeCap="round"
      />
    </>
  )
}
