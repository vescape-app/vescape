import { describe, expect, test } from 'bun:test'
import { PUBLIC_RIDE_ARC, publicRideIndexAt, publicRideSector } from './publicRideArc'

describe('public ride arc', () => {
  test('seams stay equally spaced at the inner and outer edges', () => {
    const { cx, cy, gap } = PUBLIC_RIDE_ARC
    for (let index = 0; index < 3; index++) {
      const left = publicRideSector(index)
      const right = publicRideSector(index + 1)
      const angle = Math.PI + ((index + 1) * Math.PI) / 4
      const distanceFromSeam = (point: { x: number; y: number }) =>
        Math.abs((point.x - cx) * -Math.sin(angle) + (point.y - cy) * Math.cos(angle))
      for (const point of [left.outerEnd, left.innerEnd, right.outerStart, right.innerStart]) {
        expect(distanceFromSeam(point)).toBeCloseTo(gap / 2, 8)
      }
    }
  })

  test('dragging selects the same detent from either the knob or a sector', () => {
    const { cx, cy } = PUBLIC_RIDE_ARC
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI + ((index + 0.5) * Math.PI) / 4
      for (const radius of [24, 96, 138]) {
        expect(
          publicRideIndexAt(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius),
        ).toBe(index)
      }
    }
    expect(publicRideIndexAt(cx, cy)).toBe(-1)
    expect(publicRideIndexAt(cx - 100, cy + 20)).toBe(0)
    expect(publicRideIndexAt(cx + 100, cy + 20)).toBe(3)
  })
})
