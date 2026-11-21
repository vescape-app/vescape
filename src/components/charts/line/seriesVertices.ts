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

export interface LevelVertices {
  tv: number[]
  runs: number[]
  dots: number[]
}

const EMPTY_VERTICES: LevelVertices = { tv: [], runs: [], dots: [] }

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
  const gapMs = Math.max(pyramid.gapMs, bucketMs * 2)

  for (let i = 0; i < count; i += 1) {
    const base = i * LOD_STRIDE
    const tFirst = data[base + LOD_T_FIRST]
    if (i > 0 && tFirst - data[base - LOD_STRIDE + LOD_T_LAST] > gapMs) closeRun()

    push(tFirst, data[base + LOD_V_FIRST])

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

export function buildSampleDots(pyramid: LodPyramid): number[] {
  const { ts, vs } = pyramid.raw
  const origin = pyramid.startMs
  const dots: number[] = []
  for (let i = 0; i < ts.length; i += 1) dots.push((ts[i] - origin) / 1000, vs[i])
  return dots
}

const TILE_VERTICES = 256

export interface VertexChunk {
  from: number
  to: number
}

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
