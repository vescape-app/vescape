import { describe, expect, test } from 'bun:test'

import { RAILS, railDeckProfile, railPreset, railSideFace } from '@/modules/board/lib/railPresets'
import { boardAttitudePose, curvedDeckMatrix, type AttitudeMatrix } from './boardAttitudeGeometry'

function project(matrix: AttitudeMatrix, x: number, y: number) {
  return [matrix[0] * x + matrix[1] * y + matrix[2], matrix[3] * x + matrix[4] * y + matrix[5]]
}

describe('IMU rail silhouettes', () => {
  test('asymmetric rails face right in picker and IMU preview', () => {
    const tail = railPreset('tail')
    expect(tail.points[0]).toEqual([29, 27])
    expect(tail.points[tail.points.length - 1]).toEqual([179, 31])
    expect(tail.path).toStartWith('M29 27')
    const face = railSideFace('tail')
    expect(face[0]![1]).toBeGreaterThan(face[tail.points.length - 1]![1])
  })

  test('each picker preset produces its own closed side face', () => {
    const outlines = RAILS.map(({ id, points }) => {
      const face = railSideFace(id)
      expect(face).toHaveLength(points.length * 2)
      expect(face[0]![0]).toBeLessThan(-200)
      expect(face[points.length - 1]![0]).toBeGreaterThan(200)
      for (let index = 0; index < points.length; index++) {
        const lower = face[face.length - 1 - index]!
        expect(lower[0]).toBe(
          index === 0 ? -197 : index === points.length - 1 ? 197 : face[index]![0],
        )
        expect(lower[1] - face[index]![1]).toBe(-24)
      }
      expect(railDeckProfile(id).map(([, height]) => height)).toEqual(
        face.slice(0, points.length).map(([, y]) => 12 - y),
      )
      return JSON.stringify(face)
    })
    expect(new Set(outlines).size).toBe(RAILS.length)
  })

  test('unknown saved rail falls back to XR', () => {
    expect(railPreset('removed-preset').id).toBe('xr')
    expect(railSideFace('removed-preset')).toEqual(railSideFace('xr'))
  })

  test('custom generator points preserve shape while thickness changes both side edges and end bevels', () => {
    const points = [
      [14, 32],
      [104, 38],
      [194, 29],
    ] as const
    const thin = railSideFace(undefined, points, 12)
    const defaultFace = railSideFace(undefined, points)
    const thick = railSideFace(undefined, points, 36)
    for (let index = 0; index < points.length; index++) {
      expect(thin[index]![0]).toBe(defaultFace[index]![0])
      expect(thick[index]![0]).toBe(defaultFace[index]![0])
      expect(thin[index]![1] - thin[thin.length - 1 - index]![1]).toBe(12)
      expect(thick[index]![1] - thick[thick.length - 1 - index]![1]).toBe(36)
      expect(railDeckProfile(undefined, points, 12)[index]![1]).toBe(
        railDeckProfile(undefined, points, 36)[index]![1],
      )
    }
    expect(boardAttitudePose(25, 12).rightCap[3]).not.toBe(boardAttitudePose(25, 36).rightCap[3])
    for (const thickness of [12, 24, 36]) {
      const face = railSideFace(undefined, points, thickness)
      const profile = railDeckProfile(undefined, points, thickness)
      for (const roll of [-45, 0, 45]) {
        const pose = boardAttitudePose(roll, thickness)
        const nearY = -64
        for (let index = 1; index < profile.length; index++) {
          const [x0, h0] = profile[index - 1]!
          const [x1, h1] = profile[index]!
          const top = curvedDeckMatrix(roll, x0, x1, h0, h1, -thickness / 2)
          const outer = face[index]!
          const deckPoint = project(top, x1, nearY)
          const sidePoint = project(pose.nearRail, outer[0], outer[1])
          expect(deckPoint[1]).toBeCloseTo(sidePoint[1], 7)
        }
      }
    }
  })

  test('moving custom end points changes preview length and keeps its bevels attached', () => {
    const short = [
      [30, 32],
      [104, 36],
      [178, 32],
    ] as const
    const long = [
      [14, 32],
      [104, 36],
      [194, 32],
    ] as const
    const shortFace = railSideFace(undefined, short)
    const longFace = railSideFace(undefined, long)
    expect(shortFace[0]![0]).toBeGreaterThan(longFace[0]![0])
    expect(shortFace[2]![0]).toBeLessThan(longFace[2]![0])
    expect(shortFace[1]![0]).toBe(longFace[1]![0])
    const leftCapX = shortFace[shortFace.length - 1]![0]
    const rightCapX = shortFace[shortFace.length / 2]![0]
    const bevel = leftCapX - shortFace[0]![0]
    for (const roll of [-45, 0, 45]) {
      const pose = boardAttitudePose(roll, 24, 24, 24, 0, leftCapX, rightCapX, bevel)
      for (const [cap, outer] of [
        [pose.leftCap, shortFace[0]],
        [pose.rightCap, shortFace[2]],
      ] as const) {
        for (const width of [-64, 64]) {
          const capPoint = project(cap, bevel, width)
          const railPoint = project(pose.nearRail, outer![0], outer![1])
          expect(capPoint[0]).toBeCloseTo(railPoint[0])
          if (width === -64) expect(capPoint[1]).toBeCloseTo(railPoint[1])
        }
      }
    }
  })

  test('different point thicknesses join the deck and side face through the profile', () => {
    const points = [
      [14, 32],
      [104, 38],
      [194, 29],
    ] as const
    const thicknesses = [12, 36, 24]
    const face = railSideFace(undefined, points, 24, thicknesses)
    const profile = railDeckProfile(undefined, points, 24, thicknesses)
    for (const roll of [-45, 0, 45]) {
      const pose = boardAttitudePose(roll, 24, thicknesses[0], thicknesses[2])
      for (let index = 0; index < points.length; index++) {
        const outer = face[index]!
        const inner = face[face.length - 1 - index]!
        expect(outer[1] - inner[1]).toBe(thicknesses[index]!)
        if (index === 0) continue
        const [x0, h0] = profile[index - 1]!
        const [x1, h1] = profile[index]!
        const top = curvedDeckMatrix(
          roll,
          x0,
          x1,
          h0 - thicknesses[index - 1]! / 2,
          h1 - thicknesses[index]! / 2,
          0,
        )
        const bottomX0 = index === 1 ? -197 : x0
        const bottomX1 = index === points.length - 1 ? 197 : x1
        const bottom = curvedDeckMatrix(
          roll,
          bottomX0,
          bottomX1,
          h0 + thicknesses[index - 1]! / 2,
          h1 + thicknesses[index]! / 2,
          0,
        )
        expect(project(top, x1, -64)[1]).toBeCloseTo(
          project(pose.nearRail, outer[0], outer[1])[1],
          7,
        )
        expect(project(bottom, bottomX1, -64)[1]).toBeCloseTo(
          project(pose.nearRail, inner[0], inner[1])[1],
          7,
        )
      }
    }
  })

  test('bent deck corners meet both rail edges and diagonal end cuts through a full roll', () => {
    for (const rail of RAILS) {
      const profile = railDeckProfile(rail.id)
      const face = railSideFace(rail.id)
      for (const roll of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
        const pose = boardAttitudePose(roll)
        const nearY = Math.cos((roll * Math.PI) / 180) < -1e-8 ? 64 : -64
        for (let i = 1; i < profile.length; i++) {
          const [x0, h0] = profile[i - 1]!
          const [x1, h1] = profile[i]!
          const top = curvedDeckMatrix(roll, x0, x1, h0, h1, -12)
          for (const [x, height] of [
            [x0, h0],
            [x1, h1],
          ]) {
            const railPoint = project(pose.nearRail, x, 12 - height)
            const deckPoint = project(top, x, nearY)
            expect(deckPoint[0]).toBeCloseTo(railPoint[0], 7)
            expect(deckPoint[1]).toBeCloseTo(railPoint[1], 7)
          }
        }
        for (let i = 1; i < profile.length; i++) {
          const [outerX0, h0] = profile[i - 1]!
          const [outerX1, h1] = profile[i]!
          const x0 = i === 1 ? -197 : outerX0
          const x1 = i === profile.length - 1 ? 197 : outerX1
          const bottom = curvedDeckMatrix(roll, x0, x1, h0, h1, 12)
          for (const [index, x] of [
            [i - 1, x0],
            [i, x1],
          ]) {
            const inner = face[face.length - 1 - index]!
            const deckPoint = project(bottom, x, nearY)
            const railPoint = project(pose.nearRail, inner[0], inner[1])
            expect(deckPoint[0]).toBeCloseTo(railPoint[0], 7)
            expect(deckPoint[1]).toBeCloseTo(railPoint[1], 7)
          }
        }
        for (const [index, cap] of [
          [0, pose.leftCap],
          [profile.length - 1, pose.rightCap],
        ] as const) {
          const [x, height] = profile[index]!
          const matrix = cap.slice() as AttitudeMatrix
          matrix[5] += height * Math.cos((roll * Math.PI) / 180)
          const capX = 21
          const capPoint = project(matrix, capX, nearY)
          const outerPoint = project(pose.nearRail, x, face[index]![1])
          expect(capPoint[0]).toBeCloseTo(outerPoint[0], 7)
          expect(capPoint[1]).toBeCloseTo(outerPoint[1], 7)
        }
      }
    }
  })
})
