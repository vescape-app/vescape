import { expect, test } from 'bun:test'

import { buildLodPyramid } from '@/components/charts/line/lod'
import {
  buildLevelVertices,
  buildSampleDots,
  chunkRuns,
} from '@/components/charts/line/seriesVertices'
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

function valuesOf(tv: number[]): number[] {
  const values: number[] = []
  for (let i = 1; i < tv.length; i += 2) values.push(tv[i])
  return values
}

test('vertices are seconds from the domain start, in the metric own units', () => {
  const pyramid = buildLodPyramid(series(10, (i) => i * 2))
  const { tv } = buildLevelVertices(pyramid, -1)
  expect(tv[0]).toBe(0)
  expect(tv[1]).toBe(0)
  expect(tv[2]).toBe(0.5)
  expect(tv[3]).toBe(2)
})

test('a coarse level keeps far fewer vertices than the samples it covers', () => {
  const pyramid = buildLodPyramid(series(40_000, (i) => i % 50))
  const coarsest = pyramid.levels.length - 1
  const { tv } = buildLevelVertices(pyramid, coarsest)
  expect(tv.length / 2).toBeLessThan(1_000)
})

test('a lone spike survives into the coarsest level vertices', () => {
  const pyramid = buildLodPyramid(series(40_000, (i) => (i === 20_000 ? 999 : 10)))
  const coarsest = pyramid.levels.length - 1
  const { tv } = buildLevelVertices(pyramid, coarsest)
  expect(Math.max(...valuesOf(tv))).toBe(999)
})

test('a sampling gap breaks the line into separate runs', () => {
  const ts = [BASE, BASE + 500, BASE + 1_000, BASE + 400_000, BASE + 400_500, BASE + 401_000]
  const pyramid = buildLodPyramid({ ts, vs: [10, 20, 30, 40, 50, 60] })
  const { runs } = buildLevelVertices(pyramid, -1)
  expect(runs.length / 2).toBe(2)
})

test('a sample stranded between gaps becomes a dot rather than vanishing', () => {
  // Dense, then one sample alone between two long pauses, then dense again.
  const ts = [
    BASE,
    BASE + 500,
    BASE + 1_000,
    BASE + 400_000,
    BASE + 800_000,
    BASE + 800_500,
    BASE + 801_000,
  ]
  const pyramid = buildLodPyramid({ ts, vs: [10, 20, 30, 99, 40, 50, 60] })
  const { runs, dots } = buildLevelVertices(pyramid, -1)
  expect(dots.length / 2).toBe(1)
  expect(dots[1]).toBe(99)
  expect(runs.length / 2).toBe(2)
})

test('sample dots cover every raw sample', () => {
  const pyramid = buildLodPyramid(series(100, (i) => i))
  expect(buildSampleDots(pyramid).length / 2).toBe(100)
})

test('an empty series produces nothing', () => {
  const pyramid = buildLodPyramid({ ts: [], vs: [] })
  expect(buildLevelVertices(pyramid, -1)).toEqual({ tv: [], runs: [], dots: [] })
})

test('chunks stay within the tile size and overlap by one vertex', () => {
  const chunks = chunkRuns([0, 600], 256)
  expect(chunks.length).toBe(3)
  for (const chunk of chunks) expect(chunk.to - chunk.from).toBeLessThanOrEqual(256)
  // The vertex closing one tile opens the next, so no segment is lost between them.
  expect(chunks[1].from).toBe(chunks[0].to - 1)
  expect(chunks.at(-1)!.to).toBe(600)
})

test('each run is chunked on its own so tiles never span a gap', () => {
  const chunks = chunkRuns([0, 10, 10, 20], 256)
  expect(chunks).toEqual([
    { from: 0, to: 10 },
    { from: 10, to: 20 },
  ])
})

test('a run too short to stroke produces no chunk', () => {
  expect(chunkRuns([5, 6])).toEqual([])
})
