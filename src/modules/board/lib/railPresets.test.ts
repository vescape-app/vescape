import { describe, expect, test } from 'bun:test'

import { RAILS, railDeckProfile, railPreset, railSideFace } from '@/modules/board/lib/railPresets'
import { boardAttitudePose, curvedDeckMatrix, type AttitudeMatrix } from './boardAttitudeGeometry'

function project(matrix: AttitudeMatrix, x: number, y: number) {
  return [matrix[0] * x + matrix[1] * y + matrix[2], matrix[3] * x + matrix[4] * y + matrix[5]]
}

describe('IMU rail silhouettes', () => {
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
