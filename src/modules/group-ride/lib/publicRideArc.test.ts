import { describe, expect, test } from 'bun:test'
import { PUBLIC_RIDE_ARC, publicRideIndexAt, publicRideSector } from './publicRideArc'

describe('public ride arc', () => {
  test('seams stay equally spaced at the inner and outer edges', () => {
    const { cx, cy, gap } = PUBLIC_RIDE_ARC
    for (let index = 0; index < 3; index++) {
      const left = publicRideSector(index)
      const right = publicRideSector(index + 1)
      const angle =
        ((PUBLIC_RIDE_ARC.startAngle + (index + 1) * PUBLIC_RIDE_ARC.sectorAngle) * Math.PI) / 180
      const distanceFromSeam = (point: { x: number; y: number }) =>
        Math.abs((point.x - cx) * -Math.sin(angle) + (point.y - cy) * Math.cos(angle))
      for (const point of [left.outerEnd, left.innerEnd, right.outerStart, right.innerStart]) {
        expect(distanceFromSeam(point)).toBeCloseTo(gap / 2, 8)
      }
    }
  })

  test('dragging selects the same detent at each sector across its thickness', () => {
    const { cx, cy } = PUBLIC_RIDE_ARC
    for (let index = 0; index < 4; index++) {
      const angle =
        ((PUBLIC_RIDE_ARC.startAngle + (index + 0.5) * PUBLIC_RIDE_ARC.sectorAngle) * Math.PI) / 180
      for (const radius of [PUBLIC_RIDE_ARC.innerRadius, 83, PUBLIC_RIDE_ARC.outerRadius]) {
        expect(
          publicRideIndexAt(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius),
        ).toBe(index)
      }
    }
    // Clamp touches at or below the ends of the semicircle to the outer detents.
    expect(publicRideIndexAt(cx - 100, cy)).toBe(0)
    expect(publicRideIndexAt(cx + 100, cy)).toBe(3)
    expect(publicRideIndexAt(cx, cy)).toBe(-1)
    expect(publicRideIndexAt(cx - 100, cy + 20)).toBe(0)
    expect(publicRideIndexAt(cx + 100, cy + 20)).toBe(3)
  })
})
