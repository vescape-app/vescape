import { Skia, type SkPath } from '@shopify/react-native-skia'

import { buildLodPyramid } from '@/components/charts/line/lod'
import { buildLevelVertices, chunkRuns } from '@/components/charts/line/seriesVertices'
import type { ChartSeriesData } from '@/components/charts/line/types'

/**
 * Once consecutive samples sit this far apart the line alone stops reading as data, so the
 * chart marks each sample: a rider zoomed past the sampling rate can see they are looking at
 * individual readings rather than a smooth signal.
 */
const DOT_MIN_SPACING_PX = 6

/**
 * One level of detail, cut into tiles along time.
 *
 * Tiling is what makes zooming cost the same at any depth. A frame draws by adding the tiles it
 * can see to a fresh path under the viewport matrix, so the work follows what is on screen —
 * transforming the level as a whole meant deep zoom copied every point of the ride each frame,
 * which is where ten frames a second came from.
 */
export interface LevelTiles {
  bucketMs: number
  tiles: SkPath[]
  /** Time bounds per tile, seconds from the domain start, ascending. */
  startSec: number[]
  endSec: number[]
  /** Samples stranded between gaps: too few to tile, always drawn. */
  strays: SkPath
  hasStrays: boolean
}

/**
 * A series as Skia paths in data space — the raw samples, plus one tiled level per detail step.
 *
 * Skia paths are native objects the UI thread reaches by reference, so a worklet draws any of
 * them without a single number crossing runtimes. Handing the sample arrays to a worklet
 * instead — as an earlier version did — cost a deep copy of every point on each dataset change.
 */
export interface SeriesPaths {
  /** Bucket width per entry of {@link levels}, ascending. */
  bucketMs: number[]
  levels: LevelTiles[]
  /** Every sample, drawn whenever the rider is zoomed in past the finest level. */
  raw: LevelTiles
  domainStartMs: number
  domainEndMs: number
  /** Typical spacing between samples, for deciding when individual points are worth marking. */
  sampleMs: number
  isEmpty: boolean
}

/**
 * Three decimals is a millisecond horizontally and well under a pixel vertically, and keeps the
 * path strings short enough that building them stays the cheap part.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Paths are assembled as SVG strings and parsed natively. The obvious `moveTo`/`lineTo` loop
 * costs one call across the native boundary per vertex, and at tens of thousands of samples
 * that alone took seconds — long enough to freeze the screen on a dataset change.
 */
function pathFromString(parts: string[]): SkPath {
  if (parts.length === 0) return Skia.Path.Make()
  return Skia.Path.MakeFromSVGString(parts.join('')) ?? Skia.Path.Make()
}

function tileVertices(tv: number[], runs: number[], dots: number[], bucketMs: number): LevelTiles {
  const tiles: SkPath[] = []
  const startSec: number[] = []
  const endSec: number[] = []

  for (const chunk of chunkRuns(runs)) {
    const parts: string[] = [`M${round(tv[chunk.from * 2])} ${round(tv[chunk.from * 2 + 1])}`]
    for (let i = chunk.from + 1; i < chunk.to; i += 1) {
      parts.push(`L${round(tv[i * 2])} ${round(tv[i * 2 + 1])}`)
    }
    tiles.push(pathFromString(parts))
    startSec.push(tv[chunk.from * 2])
    endSec.push(tv[(chunk.to - 1) * 2])
  }

  // A zero-length segment painted with a round cap is a circle, so lone samples cost one path
  // for the whole level rather than a node each.
  const strayParts: string[] = []
  for (let i = 0; i < dots.length; i += 2) {
    const x = round(dots[i])
    const y = round(dots[i + 1])
    strayParts.push(`M${x} ${y}L${x} ${y}`)
  }

  return {
    bucketMs,
    tiles,
    startSec,
    endSec,
    strays: pathFromString(strayParts),
    hasStrays: strayParts.length > 0,
  }
}

/**
 * Build every path for a series. Runs once per dataset, on the JS thread.
 *
 * The pyramid's finest level is deliberately skipped: it holds four vertices per four samples,
 * so it costs as much to build as the raw samples while carrying less. Below the second level
 * the chart draws the samples themselves, which is both cheaper and exact.
 */
export function buildSeriesPaths(data: ChartSeriesData): SeriesPaths {
  const pyramid = buildLodPyramid(data)
  const raw = buildLevelVertices(pyramid, -1)
  const levels = pyramid.levels.slice(1)

  return {
    bucketMs: levels.map((level) => level.bucketMs),
    levels: levels.map((level, index) => {
      const vertices = buildLevelVertices(pyramid, index + 1)
      return tileVertices(vertices.tv, vertices.runs, vertices.dots, level.bucketMs)
    }),
    raw: tileVertices(raw.tv, raw.runs, raw.dots, 0),
    domainStartMs: pyramid.startMs,
    domainEndMs: pyramid.endMs,
    sampleMs: pyramid.gapMs / 3,
    isEmpty: pyramid.raw.ts.length === 0,
  }
}

/** Whether the rider is zoomed in far enough that individual samples should be marked. */
export function shouldMarkSamples(sampleMs: number, perPixel: number): boolean {
  'worklet'
  return sampleMs / perPixel >= DOT_MIN_SPACING_PX
}

/**
 * Project the tiles overlapping `[fromSec, toSec]` into a single path.
 *
 * Tiles are ordered in time, so the first visible one is found by binary search and the walk
 * stops as soon as a tile starts past the window: the cost follows the viewport, not the ride.
 */
export function composeVisibleTiles(
  level: LevelTiles,
  fromSec: number,
  toSec: number,
  matrix: number[],
): SkPath {
  'worklet'
  const path = Skia.Path.Make()
  const transform = Skia.Matrix(matrix)

  let lo = 0
  let hi = level.endSec.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (level.endSec[mid] < fromSec) lo = mid + 1
    else hi = mid
  }

  for (let i = lo; i < level.tiles.length && level.startSec[i] <= toSec; i += 1) {
    path.addPath(level.tiles[i], transform)
  }
  if (level.hasStrays) path.addPath(level.strays, transform)
  return path
}

/** A sample read back out of a path, in data space. `found` is false for an empty series. */
export interface ScrubSample {
  sec: number
  value: number
  found: boolean
}

const NO_SAMPLE: ScrubSample = { sec: 0, value: 0, found: false }

/** Sample of one tile closest to `sec`. Tile points ascend in x, so this is a binary search. */
function nearestInTile(tile: SkPath, sec: number): ScrubSample {
  'worklet'
  const count = tile.countPoints()
  if (count === 0) return NO_SAMPLE

  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tile.getPoint(mid).x < sec) lo = mid + 1
    else hi = mid
  }

  if (lo === 0) {
    const point = tile.getPoint(0)
    return { sec: point.x, value: point.y, found: true }
  }
  if (lo >= count) {
    const point = tile.getPoint(count - 1)
    return { sec: point.x, value: point.y, found: true }
  }
  const before = tile.getPoint(lo - 1)
  const after = tile.getPoint(lo)
  return sec - before.x <= after.x - sec
    ? { sec: before.x, value: before.y, found: true }
    : { sec: after.x, value: after.y, found: true }
}

/**
 * The sample nearest a moment in time, read straight out of the paths.
 *
 * Scrubbing reports the reading that was actually recorded rather than the drawn line, so it is
 * always the raw level that is searched — never the level the current zoom happens to draw.
 * Reading it back from the path keeps the samples themselves off the UI thread: the path is a
 * native object, and only the two numbers of the answer ever cross.
 *
 * Samples stranded alone between two gaps live in the level's strays rather than a tile and are
 * not searched; they are rare enough that a scrub landing on one falls to its neighbour.
 */
export function sampleAtSec(level: LevelTiles, sec: number): ScrubSample {
  'worklet'
  const count = level.tiles.length
  if (count === 0) return NO_SAMPLE

  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (level.endSec[mid] < sec) lo = mid + 1
    else hi = mid
  }

  const index = Math.min(lo, count - 1)
  const best = nearestInTile(level.tiles[index], sec)
  // Landing between two tiles means landing in a gap: the tile before may hold the closer sample.
  if (index > 0 && level.startSec[index] > sec) {
    const previous = nearestInTile(level.tiles[index - 1], sec)
    if (previous.found && Math.abs(previous.sec - sec) < Math.abs(best.sec - sec)) return previous
  }
  return best
}

/**
 * Points of an already-projected path that fall inside the plot, as a path of dots.
 *
 * Walking every point would mean one native call per sample, so the visible span is found by
 * binary search first: the points of a series path ascend in x, and only the handful actually
 * on screen are read.
 */
export function visiblePointDots(source: SkPath, width: number): SkPath {
  'worklet'
  const dots = Skia.Path.Make()
  const count = source.countPoints()
  if (count === 0) return dots

  // No directive: a function defined inside a worklet is already part of it.
  const firstVisible = (target: number) => {
    let lo = 0
    let hi = count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (source.getPoint(mid).x < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const from = Math.max(0, firstVisible(0) - 1)
  const to = Math.min(count - 1, firstVisible(width) + 1)
  for (let i = from; i <= to; i += 1) {
    const point = source.getPoint(i)
    dots.moveTo(point.x, point.y)
    dots.lineTo(point.x, point.y)
  }
  return dots
}
