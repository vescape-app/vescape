import { Skia, type SkPath } from '@shopify/react-native-skia'

import { buildLodPyramid } from '@/components/charts/line/lod'
import { buildLevelVertices, chunkRuns } from '@/components/charts/line/seriesVertices'
import type { ChartSeriesData } from '@/components/charts/line/types'

const DOT_MIN_SPACING_PX = 6

export interface LevelTiles {
  bucketMs: number
  tiles: SkPath[]
  startSec: number[]
  endSec: number[]
  strays: SkPath
  hasStrays: boolean
}

export interface SeriesPaths {
  bucketMs: number[]
  levels: LevelTiles[]
  raw: LevelTiles
  domainStartMs: number
  domainEndMs: number
  sampleMs: number
  head: { sec: number; value: number } | null
  isEmpty: boolean
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

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

export function buildSeriesPaths(data: ChartSeriesData): SeriesPaths {
  const pyramid = buildLodPyramid(data)
  const raw = buildLevelVertices(pyramid, -1)
  const levels = pyramid.levels.slice(1)
  const { ts, vs } = pyramid.raw
  const last = ts.length - 1

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
    head: last < 0 ? null : { sec: (ts[last] - pyramid.startMs) / 1000, value: vs[last] },
    isEmpty: ts.length === 0,
  }
}

export function shouldMarkSamples(sampleMs: number, perPixel: number): boolean {
  'worklet'
  return sampleMs / perPixel >= DOT_MIN_SPACING_PX
}

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

export interface ScrubSample {
  sec: number
  value: number
  found: boolean
}

const NO_SAMPLE: ScrubSample = { sec: 0, value: 0, found: false }

function nearestInPath(tile: SkPath, sec: number): ScrubSample {
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

export function sampleAtSec(level: LevelTiles, sec: number): ScrubSample {
  'worklet'
  let best = NO_SAMPLE
  const count = level.tiles.length

  if (count > 0) {
    let lo = 0
    let hi = count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (level.endSec[mid] < sec) lo = mid + 1
      else hi = mid
    }

    const index = Math.min(lo, count - 1)
    best = nearestInPath(level.tiles[index], sec)
    if (index > 0 && level.startSec[index] > sec) {
      const previous = nearestInPath(level.tiles[index - 1], sec)
      if (previous.found && Math.abs(previous.sec - sec) < Math.abs(best.sec - sec)) best = previous
    }
  }

  if (!level.hasStrays) return best
  const stray = nearestInPath(level.strays, sec)
  if (!stray.found) return best
  if (!best.found || Math.abs(stray.sec - sec) < Math.abs(best.sec - sec)) return stray
  return best
}

export function visiblePointDots(source: SkPath, width: number): SkPath {
  'worklet'
  const dots = Skia.Path.Make()
  const count = source.countPoints()
  if (count === 0) return dots

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
