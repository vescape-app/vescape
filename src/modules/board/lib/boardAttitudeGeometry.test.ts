import { describe, expect, test } from 'bun:test'

import { boardAttitudePose, type AttitudeMatrix } from './boardAttitudeGeometry'

function project(matrix: AttitudeMatrix, x: number, y: number) {
  return [matrix[0] * x + matrix[1] * y + matrix[2], matrix[3] * x + matrix[4] * y + matrix[5]]
}

function samePoint(a: number[], b: number[]) {
  expect(a[0]).toBeCloseTo(b[0], 8)
  expect(a[1]).toBeCloseTo(b[1], 8)
}

describe('orthographic board outline', () => {
  test('deck/cap/rail corners stay joined through a full roll, including vertical faces', () => {
    for (let roll = -180; roll <= 180; roll++) {
      const pose = boardAttitudePose(roll)
      for (const y of [-64, 64]) {
        samePoint(project(pose.top, 218, y), project(pose.rightCap, 21, y))
        samePoint(project(pose.bottom, 197, y), project(pose.rightCap, 0, y))
        samePoint(project(pose.top, -218, y), project(pose.leftCap, 21, y))
        samePoint(project(pose.bottom, -197, y), project(pose.leftCap, 0, y))
      }
      const nearY = Math.cos((roll * Math.PI) / 180) < -1e-8 ? 64 : -64
      samePoint(project(pose.nearRail, 218, 12), project(pose.top, 218, nearY))
      samePoint(project(pose.nearRail, 197, -12), project(pose.bottom, 197, nearY))
    }
  })

  test('swaps visible side after rolling past edge-on and closes the tread at both rings', () => {
    for (const roll of [-180, -135, -90, -25, 0, 25, 90, 135, 180]) {
      const pose = boardAttitudePose(roll)
      for (const x of [-78, 78]) {
        const ends = [project(pose.tread, x, -43)[1], project(pose.tread, x, 43)[1]].sort(
          (a, b) => a - b,
        )
        const rings = [project(pose.nearTire, x, 0)[1], project(pose.farTire, x, 0)[1]].sort(
          (a, b) => a - b,
        )
        expect(ends[0]).toBeCloseTo(rings[0], 8)
        expect(ends[1]).toBeCloseTo(rings[1], 8)
      }
      expect(pose.topVisible + pose.bottomVisible).toBe(1)
    }
    expect(boardAttitudePose(25).nearTire[5]).toBeGreaterThan(0)
    expect(boardAttitudePose(155).nearTire[5]).toBeLessThan(0)
  })

  test('edge-on fallback covers singular ellipses and rails without affecting ordinary riding', () => {
    for (const roll of [-90, 90, 270]) expect(boardAttitudePose(roll).edgeOnOpacity).toBe(1)
    for (const roll of [-28, 0, 25, 180]) expect(boardAttitudePose(roll).edgeOnOpacity).toBe(0)
    expect(boardAttitudePose(89.5).edgeOnOpacity).toBeGreaterThan(0)
    expect(boardAttitudePose(89.5).edgeOnOpacity).toBeLessThan(1)
  })

  test('neutral and inverted poses are centered and missing telemetry returns neutral', () => {
    const neutral = boardAttitudePose(0)
    expect(project(neutral.nearRail, 0, 12)[1]).toBe(-12)
    expect(project(neutral.nearRail, 0, -12)[1]).toBe(12)
    for (let i = 0; i < 9; i++) {
      expect(neutral.nearTire[i]).toBeCloseTo(neutral.farTire[i], 8)
      expect(boardAttitudePose(180).nearTire[i]).toBeCloseTo(neutral.nearTire[i], 8)
    }
    for (const value of [null, NaN, Infinity, -Infinity, 360]) {
      expect(boardAttitudePose(value)).toEqual(neutral)
    }
  })
})
