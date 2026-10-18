import { describe, expect, test } from 'bun:test'

import { buildRailPath, sampleRailProfile, sampleRailValues } from '@/modules/board/lib/railProfile'

describe('buildRailPath', () => {
  test('keeps zero-smoothing presets as exact straight segments', () => {
    expect(
      buildRailPath(
        [
          [30, 32],
          [104, 37],
          [179, 32],
        ],
        [0, 0, 0],
      ),
    ).toBe('M30 32 L104 37 L179 32')
  })

  test('rounds a smoothed interior point with a quadratic corner', () => {
    expect(
      buildRailPath(
        [
          [30, 32],
          [104, 37],
          [179, 32],
        ],
        [0, 100, 0],
      ),
    ).toContain('Q104 37')
  })
})

test('3D preview samples rounded corners while preserving ordered endpoints', () => {
  const points = [
    [14, 32],
    [104, 38],
    [194, 32],
  ] as const
  const sampled = sampleRailProfile(points, [0, 100, 0])
  expect(sampled[0]).toEqual(points[0])
  expect(sampled[sampled.length - 1]).toEqual(points[2])
  expect(sampled.length).toBeGreaterThan(points.length)
  for (let index = 1; index < sampled.length; index++) {
    expect(sampled[index]![0]).toBeGreaterThan(sampled[index - 1]![0])
  }
})

test('point thickness interpolates through smoothed preview samples', () => {
  const points = [
    [14, 32],
    [104, 38],
    [194, 32],
  ] as const
  const sampled = sampleRailProfile(points, [0, 100, 0])
  const values = sampleRailValues(points, [12, 36, 24], sampled)
  expect(values[0]).toBe(12)
  expect(values[values.length - 1]).toBe(24)
  for (let index = 1; index < sampled.length; index++) {
    expect(Math.abs(values[index]! - values[index - 1]!)).toBeLessThan(24)
  }
  expect(values.some((value) => value > 24 && value < 36)).toBe(true)
})
