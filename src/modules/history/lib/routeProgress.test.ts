import { describe, expect, test } from 'bun:test'

import { progressAtTime, routeTimeProgress } from '@/modules/history/lib/routeProgress'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

/** Three fixes on a straight line, the second leg twice as long as the first. */
const samples = [
  { capturedAtMs: 1_000, latitude: 0, longitude: 0 },
  { capturedAtMs: 2_000, latitude: 0, longitude: 0.001 },
  { capturedAtMs: 4_000, latitude: 0, longitude: 0.003 },
] as HistoryGpsSample[]

describe('progressAtTime', () => {
  const progress = routeTimeProgress(samples)

  test('measures distance travelled, not time elapsed', () => {
    // Half the ride by time, a third of it by distance.
    expect(progressAtTime(2_000, progress)).toBeCloseTo(1 / 3, 3)
  })

  test('interpolates between the fixes bracketing a moment', () => {
    expect(progressAtTime(3_000, progress)).toBeCloseTo(2 / 3, 3)
  })

  test('clamps outside the ride', () => {
    expect(progressAtTime(0, progress)).toBe(0)
    expect(progressAtTime(9_000, progress)).toBe(1)
  })

  test('a route with no fixes is all at the start', () => {
    expect(progressAtTime(1_000, { ts: [], at: [] })).toBe(0)
  })
})
