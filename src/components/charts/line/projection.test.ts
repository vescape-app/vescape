import { expect, test } from 'bun:test'

import {
  MIN_SPAN_MS,
  lowerBound,
  nearestIndex,
  projectX,
  projectY,
  resolveViewport,
  unprojectX,
  viewportFor,
  viewportMatrix,
} from '@/components/charts/line/projection'

const BASE = 1_700_000_000_000
const VIEWPORT = { startMs: BASE, endMs: BASE + 10_000 }

test('x projection spans the plot width', () => {
  expect(projectX(BASE, VIEWPORT, 300)).toBe(0)
  expect(projectX(BASE + 10_000, VIEWPORT, 300)).toBe(300)
  expect(projectX(BASE + 5_000, VIEWPORT, 300)).toBe(150)
})

test('x projection round-trips through unprojectX', () => {
  const timeMs = BASE + 3_333
  expect(unprojectX(projectX(timeMs, VIEWPORT, 300), VIEWPORT, 300)).toBeCloseTo(timeMs, 6)
})

test('higher values project upward and stay inside the plot', () => {
  const range = { min: 0, max: 100 }
  const low = projectY(0, range, 50)
  const high = projectY(100, range, 50)
  expect(high).toBeLessThan(low)
  expect(high).toBeGreaterThanOrEqual(0)
  expect(low).toBeLessThanOrEqual(50)
})

test('a flat range does not divide by zero', () => {
  expect(projectY(5, { min: 5, max: 5 }, 50)).toBe(25)
})

test('a following camera rides the live head', () => {
  const viewport = resolveViewport(
    { spanMs: 60_000, endMs: null, key: 'ride' },
    BASE + 500_000,
    BASE,
    BASE + 500_000,
  )
  expect(viewport.endMs).toBe(BASE + 500_000)
  expect(viewport.startMs).toBe(BASE + 440_000)
})

test('a detached camera cannot be panned out of the data', () => {
  const past = resolveViewport(
    { spanMs: 60_000, endMs: BASE - 999_999, key: 'ride' },
    BASE,
    BASE,
    BASE + 500_000,
  )
  expect(past.startMs).toBe(BASE)
  const future = resolveViewport(
    { spanMs: 60_000, endMs: BASE + 999_999, key: 'ride' },
    BASE,
    BASE,
    BASE + 500_000,
  )
  expect(future.endMs).toBe(BASE + 500_000)
})

test('span is clamped to the data and to the zoom floor', () => {
  const wide = resolveViewport(
    { spanMs: 9_999_999, endMs: null, key: 'ride' },
    BASE + 1_000,
    BASE,
    BASE + 1_000,
  )
  expect(wide.endMs - wide.startMs).toBe(1_000)
  const tight = resolveViewport(
    { spanMs: 0, endMs: null, key: 'ride' },
    BASE + 1_000,
    BASE,
    BASE + 1_000,
  )
  expect(tight.endMs - tight.startMs).toBe(MIN_SPAN_MS)
})

test('lowerBound finds the insertion point', () => {
  const values = [10, 20, 30]
  expect(lowerBound(values, 5)).toBe(0)
  expect(lowerBound(values, 20)).toBe(1)
  expect(lowerBound(values, 25)).toBe(2)
  expect(lowerBound(values, 99)).toBe(3)
})

test('nearestIndex picks the closer neighbour', () => {
  const values = [10, 20, 30]
  expect(nearestIndex(values, 5)).toBe(0)
  expect(nearestIndex(values, 24)).toBe(1)
  expect(nearestIndex(values, 26)).toBe(2)
  expect(nearestIndex(values, 99)).toBe(2)
  expect(nearestIndex([], 1)).toBe(-1)
})

test('the viewport matrix maps the domain onto the plot', () => {
  const matrix = viewportMatrix(
    { startMs: BASE, endMs: BASE + 10_000 },
    BASE,
    { min: 0, max: 100 },
    300,
    50,
  )
  const applyX = (seconds: number) => matrix[0] * seconds + matrix[2]
  const applyY = (value: number) => matrix[4] * value + matrix[5]

  expect(applyX(0)).toBeCloseTo(0, 6)
  expect(applyX(10)).toBeCloseTo(300, 6)
  expect(applyY(100)).toBeLessThan(applyY(0))
  expect(applyY(100)).toBeGreaterThanOrEqual(0)
  expect(applyY(0)).toBeLessThanOrEqual(50)
})

test('the matrix agrees with the scalar projections it replaces', () => {
  const viewport = { startMs: BASE + 4_000, endMs: BASE + 9_000 }
  const range = { min: -5, max: 45 }
  const matrix = viewportMatrix(viewport, BASE, range, 300, 50)
  const timeMs = BASE + 7_000

  expect(matrix[0] * ((timeMs - BASE) / 1000) + matrix[2]).toBeCloseTo(
    projectX(timeMs, viewport, 300),
    6,
  )
  expect(matrix[4] * 20 + matrix[5]).toBeCloseTo(projectY(20, range, 50), 6)
})

test('a flat range does not produce an infinite matrix', () => {
  const matrix = viewportMatrix(
    { startMs: BASE, endMs: BASE + 1 },
    BASE,
    { min: 5, max: 5 },
    300,
    50,
  )
  for (const entry of matrix) expect(Number.isFinite(entry)).toBe(true)
})

test('a camera aimed at other data shows the full domain', () => {
  const viewport = viewportFor(
    { spanMs: 1_000, endMs: BASE + 2_000, key: 'other-ride' },
    'this-ride',
    BASE,
    BASE + 500_000,
  )
  expect(viewport).toEqual({ startMs: BASE, endMs: BASE + 500_000 })
})

test('a camera aimed at this data keeps its zoom', () => {
  const viewport = viewportFor(
    { spanMs: 60_000, endMs: BASE + 200_000, key: 'ride' },
    'ride',
    BASE,
    BASE + 500_000,
  )
  expect(viewport).toEqual({ startMs: BASE + 140_000, endMs: BASE + 200_000 })
})
