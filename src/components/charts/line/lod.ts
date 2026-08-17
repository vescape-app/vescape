import type { ChartSeriesData } from '@/components/charts/line/types'

/**
 * Numbers per decimated bucket: the first and last sample of the bucket plus its extremes,
 * each as a `(t, v)` pair. Keeping the extremes — rather than an average or a centre pick —
 * is what makes a one-sample current spike survive to the screen at any zoom level: at every
 * level the bucket containing it still carries its exact value and timestamp.
 */
export const LOD_STRIDE = 8

export const LOD_T_FIRST = 0
export const LOD_V_FIRST = 1
export const LOD_T_MIN = 2
export const LOD_V_MIN = 3
export const LOD_T_MAX = 4
export const LOD_V_MAX = 5
export const LOD_T_LAST = 6
export const LOD_V_LAST = 7

/** Runs separated by more than this multiple of the median sample interval are drawn broken. */
const GAP_MULTIPLIER = 3

/** Coarsest useful level: past this the whole series is a handful of buckets. */
const MIN_BUCKETS = 4

/** A decimated level. Buckets sit on an absolute `floor(ts / bucketMs)` grid. */
export interface LodLevel {
  bucketMs: number
  /** Flat, {@link LOD_STRIDE} numbers per bucket, ascending in time. */
  data: number[]
  count: number
}

export interface LodPyramid {
  raw: ChartSeriesData
  /** Ascending `bucketMs`; empty when the series is too short to be worth decimating. */
  levels: LodLevel[]
  gapMs: number
  startMs: number
  endMs: number
  minValue: number
  maxValue: number
}

export const EMPTY_PYRAMID: LodPyramid = {
  raw: { ts: [], vs: [] },
  levels: [],
  gapMs: Number.POSITIVE_INFINITY,
  startMs: 0,
  endMs: 0,
  minValue: 0,
  maxValue: 0,
}

/**
 * Median gap between consecutive samples. Median rather than mean so a single long pause —
 * a reconnect, a charging stop — does not drag the threshold up and hide every real gap.
 */
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

/** Round up to a power of two so every level's grid nests inside the coarser one. */
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

/**
 * Build the decimation pyramid for a series. Every level halves the resolution of the one
 * below, so the level whose buckets land at roughly one screen pixel can be picked in a
 * worklet by a division. Levels are built from the raw samples rather than from the level
 * below: the extremes stay exact instead of accumulating rounding across levels.
 */
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
    // Four samples per bucket at the finest level: eight numbers per bucket then costs no
    // more than the samples it replaces, and anything denser is served by the raw array.
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
