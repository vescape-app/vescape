import { expect, test } from 'bun:test'

import { buildLodPyramid, LOD_STRIDE, LOD_V_MAX, LOD_V_MIN } from '@/components/charts/line/lod'
import { pickLevel } from '@/components/charts/line/projection'
import type { ChartSeriesData } from '@/components/charts/line/types'

const BASE = 1_700_000_000_000

function series(count: number, value: (index: number) => number, stepMs = 500): ChartSeriesData {
  const ts: number[] = []
  const vs: number[] = []
  for (let i = 0; i < count; i += 1) {
    ts.push(BASE + i * stepMs)
    vs.push(value(i))
  }
  return { ts, vs }
}

test('levels get coarser and smaller as they go up', () => {
  const pyramid = buildLodPyramid(series(4_000, (i) => i % 17))
  expect(pyramid.levels.length).toBeGreaterThan(3)
  for (let i = 1; i < pyramid.levels.length; i += 1) {
    expect(pyramid.levels[i].bucketMs).toBe(pyramid.levels[i - 1].bucketMs * 2)
    expect(pyramid.levels[i].count).toBeLessThan(pyramid.levels[i - 1].count)
  }
})

test('a lone spike survives at every level', () => {
  const spikeIndex = 2_345
  const data = series(4_000, (i) => (i === spikeIndex ? 999 : 10))
  const pyramid = buildLodPyramid(data)
  const spikeMs = data.ts[spikeIndex]

  for (const level of pyramid.levels) {
    let found = false
    for (let i = 0; i < level.count; i += 1) {
      if (level.data[i * LOD_STRIDE + LOD_V_MAX] === 999) found = true
    }
    expect(found).toBe(true)
  }
  expect(pyramid.maxValue).toBe(999)
  // The spike is preserved with its own timestamp, not the bucket's.
  const coarsest = pyramid.levels[pyramid.levels.length - 1]
  for (let i = 0; i < coarsest.count; i += 1) {
    if (coarsest.data[i * LOD_STRIDE + LOD_V_MAX] === 999) {
      expect(coarsest.data[i * LOD_STRIDE + 4]).toBe(spikeMs)
    }
  }
})

test('a lone dip survives too', () => {
  const pyramid = buildLodPyramid(series(4_000, (i) => (i === 100 ? -50 : 10)))
  for (const level of pyramid.levels) {
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < level.count; i += 1) {
      min = Math.min(min, level.data[i * LOD_STRIDE + LOD_V_MIN])
    }
    expect(min).toBe(-50)
  }
})

test('short series need no levels', () => {
  const pyramid = buildLodPyramid(series(3, () => 1))
  expect(pyramid.levels).toEqual([])
  expect(pyramid.startMs).toBe(BASE)
})

test('empty series yields an empty pyramid', () => {
  const pyramid = buildLodPyramid({ ts: [], vs: [] })
  expect(pyramid.raw.ts).toEqual([])
  expect(pyramid.levels).toEqual([])
})

test('gaps do not merge into one bucket', () => {
  const ts = [BASE, BASE + 500, BASE + 1_000, BASE + 600_000, BASE + 600_500]
  const pyramid = buildLodPyramid({ ts, vs: [1, 2, 3, 4, 5] })
  const level = pyramid.levels[0]
  expect(level).toBeDefined()
  const firstTimes: number[] = []
  for (let i = 0; i < level.count; i += 1) firstTimes.push(level.data[i * LOD_STRIDE])
  expect(firstTimes.at(-1)).toBeGreaterThanOrEqual(BASE + 600_000)
})

test('pickLevel takes the coarsest level under one pixel', () => {
  const pyramid = buildLodPyramid(series(4_000, (i) => i))
  const buckets = pyramid.levels.map((level) => level.bucketMs)
  const zoomedOut = pickLevel(buckets, 60_000)
  const zoomedIn = pickLevel(buckets, 10)
  expect(zoomedIn).toBe(-1)
  expect(pyramid.levels[zoomedOut].bucketMs).toBeLessThanOrEqual(60_000)
  expect(pyramid.levels[zoomedOut + 1].bucketMs).toBeGreaterThan(60_000)
  expect(pickLevel(buckets, 10_000_000)).toBe(pyramid.levels.length - 1)
})
