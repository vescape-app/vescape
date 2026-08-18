import {
  LOD_STRIDE,
  LOD_T_FIRST,
  LOD_T_LAST,
  LOD_T_MAX,
  LOD_T_MIN,
  LOD_V_FIRST,
  LOD_V_LAST,
  LOD_V_MAX,
  LOD_V_MIN,
  type LodPyramid,
} from '@/components/charts/line/lod'

/**
 * Vertices are held in *data space* — seconds since the start of the domain, and the metric's
 * own units — never in pixels. The viewport then becomes a matrix applied to a finished path
 * rather than a reprojection of every point, which is what keeps zooming free.
 *
 * Seconds rather than milliseconds because Skia stores coordinates as 32-bit floats: a
 * day-long ride in milliseconds would quantise to about 8ms per step, while in seconds it
 * stays exact to well under a millisecond.
 */
export interface LevelVertices {
  /** Flat `[t0, v0, t1, v1, ...]`, seconds from the domain start. */
  tv: number[]
  /** Flat `[startVertex, endVertex, ...]` — the runs a sampling gap breaks the line into. */
  runs: number[]
  /** Flat `[t, v, ...]`: samples left alone between two gaps, which no run can stroke. */
  dots: number[]
}

const EMPTY_VERTICES: LevelVertices = { tv: [], runs: [], dots: [] }

/**
 * Vertices for one level of the pyramid, or for the raw samples when `level` is `-1`.
 *
 * Runs once per dataset on the JS thread — the result is turned into a Skia path immediately
 * afterwards, and it is that path, not this array, that the UI thread ever sees.
 */
export function buildLevelVertices(pyramid: LodPyramid, level: number): LevelVertices {
  if (pyramid.raw.ts.length === 0) return EMPTY_VERTICES

  const origin = pyramid.startMs
  const tv: number[] = []
  const runs: number[] = []
  const dots: number[] = []
  let runStart = 0

  const push = (timeMs: number, value: number) => {
    tv.push((timeMs - origin) / 1000, value)
  }

  /** Close the open run: a single vertex cannot be stroked, so it becomes a dot. */
  const closeRun = () => {
    const end = tv.length / 2
    if (end - runStart === 1) dots.push(tv[runStart * 2], tv[runStart * 2 + 1])
    else if (end - runStart > 1) runs.push(runStart, end)
    runStart = end
  }

  if (level < 0) {
    const { ts, vs } = pyramid.raw
    for (let i = 0; i < ts.length; i += 1) {
      if (i > 0 && ts[i] - ts[i - 1] > pyramid.gapMs) closeRun()
      push(ts[i], vs[i])
    }
    closeRun()
    return { tv, runs, dots }
  }

  const { data, count, bucketMs } = pyramid.levels[level]
  // A gap only reads as a gap once it is wider than the buckets themselves.
  const gapMs = Math.max(pyramid.gapMs, bucketMs * 2)

  for (let i = 0; i < count; i += 1) {
    const base = i * LOD_STRIDE
    const tFirst = data[base + LOD_T_FIRST]
    if (i > 0 && tFirst - data[base - LOD_STRIDE + LOD_T_LAST] > gapMs) closeRun()

    push(tFirst, data[base + LOD_V_FIRST])

    // Extremes in the order they occurred, so the drawn bucket keeps the shape of the signal
    // instead of always spiking the same way first.
    const tMin = data[base + LOD_T_MIN]
    const tMax = data[base + LOD_T_MAX]
    const minFirst = tMin <= tMax
    const tA = minFirst ? tMin : tMax
    const vA = minFirst ? data[base + LOD_V_MIN] : data[base + LOD_V_MAX]
    const tB = minFirst ? tMax : tMin
    const vB = minFirst ? data[base + LOD_V_MAX] : data[base + LOD_V_MIN]
    const tLast = data[base + LOD_T_LAST]

    if (tA > tFirst && tA < tLast) push(tA, vA)
    if (tB > tA && tB < tLast) push(tB, vB)
    if (tLast > tFirst) push(tLast, data[base + LOD_V_LAST])
  }
  closeRun()

  return { tv, runs, dots }
}

/** Every raw sample, for the zoom levels where individual readings should be marked. */
export function buildSampleDots(pyramid: LodPyramid): number[] {
  const { ts, vs } = pyramid.raw
  const origin = pyramid.startMs
  const dots: number[] = []
  for (let i = 0; i < ts.length; i += 1) dots.push((ts[i] - origin) / 1000, vs[i])
  return dots
}

/**
 * Vertices per tile. A frame composes only the tiles it can see, so this trades a little more
 * per-tile bookkeeping for a per-frame cost that no longer grows as the rider zooms in.
 */
const TILE_VERTICES = 256

export interface VertexChunk {
  /** Vertex indices, `[from, to)`. */
  from: number
  to: number
}

/**
 * Split runs into tiles of at most {@link TILE_VERTICES} vertices.
 *
 * Consecutive tiles of the same run overlap by one vertex, so the segment spanning a tile
 * boundary is drawn by the earlier tile and the line has no gap where the tiles meet.
 */
export function chunkRuns(runs: number[], maxVertices = TILE_VERTICES): VertexChunk[] {
  const chunks: VertexChunk[] = []
  for (let run = 0; run < runs.length; run += 2) {
    const runStart = runs[run]
    const runEnd = runs[run + 1]
    for (let from = runStart; from < runEnd - 1; from += maxVertices - 1) {
      chunks.push({ from, to: Math.min(from + maxVertices, runEnd) })
    }
  }
  return chunks
}
