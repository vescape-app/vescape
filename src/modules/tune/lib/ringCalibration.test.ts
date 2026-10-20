import { ringControlPatch } from './ringModel'
import { describe, expect, test } from 'bun:test'
import { DEFAULT_RING_ANCHORS, validateRingAnchors } from './ringCalibration'

describe('temporary Feel calibration', () => {
  test('evaluates all anchors and interpolates each segment without Floaty rounding', () => {
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 0, 0).kp).toBe(15)
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 0, 5).kp).toBe(22.5)
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 0, 10).kp).toBe(30)
    const anchors = { ...DEFAULT_RING_ANCHORS, kp: [15, 20, 30] as [number, number, number] }
    expect(ringControlPatch(anchors, 0, 2.5).kp).toBe(17.5)
    expect(ringControlPatch(anchors, 0, 7.5).kp).toBe(25)
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 0, 5).ki).toBeCloseTo(0.0225)
  })
  test('owns only selected fields and leaves calibration inputs unchanged', () => {
    const before = JSON.stringify(DEFAULT_RING_ANCHORS)
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 1, 5)).toEqual({
      torquetilt_strength_regen: 0.15,
    })
    expect(ringControlPatch(DEFAULT_RING_ANCHORS, 2, 5)).toEqual({ torquetilt_strength: 0.15 })
    expect(Object.keys(ringControlPatch(DEFAULT_RING_ANCHORS, 0, 5))).toEqual([
      'kp',
      'kp2',
      'ki',
      'mahony_kp',
      'mahony_kp_roll',
    ])
    expect(JSON.stringify(DEFAULT_RING_ANCHORS)).toBe(before)
  })
  test('rejects invalid anchors and invalid control values', () => {
    expect(validateRingAnchors(DEFAULT_RING_ANCHORS)).toBeNull()
    for (const kp of [
      [15, NaN, 30],
      [15, 20, Infinity],
      [15, 20, 51],
      [15, 10, 30],
      [15, 15, 30],
    ] as [number, number, number][]) {
      expect(validateRingAnchors({ ...DEFAULT_RING_ANCHORS, kp })).not.toBeNull()
    }
    expect(validateRingAnchors({ ...DEFAULT_RING_ANCHORS, mahony_kp: [1, 2, 3] })).not.toBeNull()
    for (const value of [NaN, Infinity, -0.1, 10.1])
      expect(() => ringControlPatch(DEFAULT_RING_ANCHORS, 0, value)).toThrow()
  })
})
