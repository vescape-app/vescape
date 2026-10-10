import { expect, test } from 'bun:test'

import { buildTimeline, toChartMs, toRealMs } from '@/components/charts/line/timeline'

const MINUTE = 60_000
const OPTIONS = { minGapMs: 5 * MINUTE, gapWidthMs: 30_000 }

/** Two minutes of riding, a half-hour pause, then two more. */
function pausedRide(): number[] {
  const ts: number[] = []
  for (let i = 0; i <= 2; i += 1) ts.push(i * MINUTE)
  for (let i = 0; i <= 2; i += 1) ts.push(32 * MINUTE + i * MINUTE)
  return ts
}

test('a ride with no long pause needs no timeline', () => {
  expect(buildTimeline([0, MINUTE, 2 * MINUTE], OPTIONS)).toBeNull()
  expect(buildTimeline([0], OPTIONS)).toBeNull()
})

test('a pause collapses to the gap width', () => {
  const timeline = buildTimeline(pausedRide(), OPTIONS)!
  expect(timeline.gapStartMs).toEqual([2 * MINUTE])
  expect(timeline.gapEndMs).toEqual([32 * MINUTE])
  // Two minutes ridden, the cut, two minutes ridden.
  expect(toChartMs(34 * MINUTE, timeline) - toChartMs(0, timeline)).toBe(4 * MINUTE + 30_000)
})

test('riding time keeps its real spacing on either side of a cut', () => {
  const timeline = buildTimeline(pausedRide(), OPTIONS)!
  expect(toChartMs(MINUTE, timeline) - toChartMs(0, timeline)).toBe(MINUTE)
  expect(toChartMs(34 * MINUTE, timeline) - toChartMs(33 * MINUTE, timeline)).toBe(MINUTE)
})

test('the mapping is invertible, inside a cut as well as outside one', () => {
  const timeline = buildTimeline(pausedRide(), OPTIONS)!
  for (const realMs of [0, MINUTE, 2 * MINUTE, 17 * MINUTE, 32 * MINUTE, 34 * MINUTE]) {
    expect(toRealMs(toChartMs(realMs, timeline), timeline)).toBeCloseTo(realMs, 3)
  }
})

test('the mapping stays monotonic across a cut', () => {
  const timeline = buildTimeline(pausedRide(), OPTIONS)!
  let previous = Number.NEGATIVE_INFINITY
  for (let realMs = 0; realMs <= 34 * MINUTE; realMs += 10_000) {
    const chartMs = toChartMs(realMs, timeline)
    expect(chartMs).toBeGreaterThan(previous)
    previous = chartMs
  }
})

test('moments outside the ride clamp to its ends', () => {
  const timeline = buildTimeline(pausedRide(), OPTIONS)!
  expect(toChartMs(-MINUTE, timeline)).toBe(toChartMs(0, timeline))
  expect(toRealMs(toChartMs(34 * MINUTE, timeline) + MINUTE, timeline)).toBe(34 * MINUTE)
})

test('no timeline is the identity', () => {
  expect(toChartMs(1234, null)).toBe(1234)
  expect(toRealMs(1234, null)).toBe(1234)
})
