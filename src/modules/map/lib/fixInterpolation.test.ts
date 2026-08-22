import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_GLIDE_MS,
  glideDurationMs,
  interpolateFix,
} from '@/modules/map/lib/fixInterpolation'

describe('glideDurationMs', () => {
  test('follows the measured cadence of the fix stream', () => {
    expect(glideDurationMs(10_000, 11_000)).toBe(1_000)
    expect(glideDurationMs(10_000, 10_500)).toBe(500)
  })

  /**
   * A glide that outlasts the gap it covers leaves the puck further behind on every fix while the
   * trail keeps up, drawing a line that runs ahead and doubles back. Bursts must stay instant.
   */
  test('keeps up with fixes arriving faster than any floor would allow', () => {
    expect(glideDurationMs(10_000, 10_005)).toBe(5)
    expect(glideDurationMs(10_000, 10_001)).toBe(1)
  })

  test('falls back before a cadence can be measured', () => {
    expect(glideDurationMs(null, 11_000)).toBe(DEFAULT_GLIDE_MS)
  })

  /** A stalled stream must not leave the puck crawling through a position it has long left. */
  test('caps a long gap instead of gliding across the whole stall', () => {
    expect(glideDurationMs(10_000, 30_000)).toBe(2_000)
  })

  test('ignores a non-advancing timestamp rather than freezing or reversing', () => {
    expect(glideDurationMs(11_000, 11_000)).toBe(DEFAULT_GLIDE_MS)
    expect(glideDurationMs(12_000, 11_000)).toBe(DEFAULT_GLIDE_MS)
  })
})

describe('interpolateFix', () => {
  const from = { latitude: 51, longitude: 17 }
  const to = { latitude: 51.002, longitude: 17.004 }

  test('lands on each end of the segment', () => {
    expect(interpolateFix(from, to, 0)).toEqual(from)
    expect(interpolateFix(from, to, 1)).toEqual(to)
  })

  test('sits halfway at the midpoint', () => {
    const at = interpolateFix(from, to, 0.5)

    expect(at.latitude).toBeCloseTo(51.001, 6)
    expect(at.longitude).toBeCloseTo(17.002, 6)
  })

  test('clamps past the ends so a late frame cannot overshoot the fix', () => {
    expect(interpolateFix(from, to, 1.4)).toEqual(to)
    expect(interpolateFix(from, to, -0.2)).toEqual(from)
  })

  /** Crossing the antimeridian must sweep metres, not the long way round the planet. */
  test('takes the short way across the antimeridian', () => {
    const at = interpolateFix(
      { latitude: 0, longitude: 179.99 },
      { latitude: 0, longitude: -179.99 },
      0.5,
    )

    expect(Math.abs(at.longitude)).toBeCloseTo(180, 6)
  })
})
