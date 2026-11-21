import type { ChartSeriesData } from '@/components/charts/line/types'

export const LOD_STRIDE = 8

export const LOD_T_FIRST = 0
export const LOD_V_FIRST = 1
export const LOD_T_MIN = 2
export const LOD_V_MIN = 3
export const LOD_T_MAX = 4
export const LOD_V_MAX = 5
export const LOD_T_LAST = 6
export const LOD_V_LAST = 7

const GAP_MULTIPLIER = 3

const MIN_BUCKETS = 4

export interface LodLevel {
  bucketMs: number
  data: number[]
  count: number
}

export interface LodPyramid {
  raw: ChartSeriesData
  levels: LodLevel[]
  gapMs: number
  startMs: number
  endMs: number
  minValue: number
  maxValue: number
}

const EMPTY_PYRAMID: LodPyramid = {
  raw: { ts: [], vs: [] },
  levels: [],
  gapMs: Number.POSITIVE_INFINITY,
  startMs: 0,
  endMs: 0,
  minValue: 0,
  maxValue: 0,
}

function medianIntervalMs(ts: number[]): number {
  if (ts.length < 2) return 0
  const deltas: number[] = []
  for (let i = 1; i < ts.length; i += 1) {
    const delta = ts[i] - ts[i - 1]
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length === 0) return 0
  deltas.sort((a, b) => a - b)
  return deltas[deltas.length >> 1]
}

function pow2Ceil(value: number): number {
  let result = 1
  while (result < value) result *= 2
  return result
}

function buildLevel(raw: ChartSeriesData, bucketMs: number): LodLevel {
  const { ts, vs } = raw
  const data: number[] = []
  let count = 0
  let index = 0

  while (index < ts.length) {
    const bucket = Math.floor(ts[index] / bucketMs)
    let tMin = ts[index]
    let vMin = vs[index]
    let tMax = ts[index]
    let vMax = vs[index]
    const tFirst = ts[index]
    const vFirst = vs[index]
    let last = index

    while (last + 1 < ts.length && Math.floor(ts[last + 1] / bucketMs) === bucket) {
      last += 1
      const value = vs[last]
      if (value < vMin) {
        vMin = value
        tMin = ts[last]
      }
      if (value > vMax) {
        vMax = value
        tMax = ts[last]
      }
    }

    data.push(tFirst, vFirst, tMin, vMin, tMax, vMax, ts[last], vs[last])
    count += 1
    index = last + 1
  }

  return { bucketMs, data, count }
}

export function buildLodPyramid(raw: ChartSeriesData): LodPyramid {
  const { ts, vs } = raw
  if (ts.length === 0) return EMPTY_PYRAMID

  let minValue = vs[0]
  let maxValue = vs[0]
  for (let i = 1; i < vs.length; i += 1) {
    if (vs[i] < minValue) minValue = vs[i]
    if (vs[i] > maxValue) maxValue = vs[i]
  }

  const interval = medianIntervalMs(ts)
  const spanMs = ts[ts.length - 1] - ts[0]
  const levels: LodLevel[] = []

  if (interval > 0 && spanMs > 0) {
    let bucketMs = pow2Ceil(interval) * 4
    while (spanMs / bucketMs >= MIN_BUCKETS) {
      levels.push(buildLevel(raw, bucketMs))
      bucketMs *= 2
    }
  }

  return {
    raw,
    levels,
    gapMs: interval > 0 ? interval * GAP_MULTIPLIER : Number.POSITIVE_INFINITY,
    startMs: ts[0],
    endMs: ts[ts.length - 1],
    minValue,
    maxValue,
  }
}
