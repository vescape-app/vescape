import { describe, expect, test } from 'bun:test'
import {
  PUBLIC_RIDE_ARC,
  publicRideIndexAt,
  publicRideSector,
  publicRideStableIndexAt,
} from './publicRideArc'

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

test('seam jitter keeps its current sector until the finger clearly crosses', () => {
  const { cx, cy, startAngle, sectorAngle } = PUBLIC_RIDE_ARC
  for (let seam = 1; seam < 4; seam++) {
    const boundary = startAngle + seam * sectorAngle
    const at = (offset: number, previous: number) => {
      const radians = ((boundary + offset) * Math.PI) / 180
      return publicRideStableIndexAt(
        cx + Math.cos(radians) * 100,
        cy + Math.sin(radians) * 100,
        previous,
      )
    }
    for (const offset of [-1, -0.2, 0.2, 1]) {
      expect(at(offset, seam - 1)).toBe(seam - 1)
      expect(at(offset, seam)).toBe(seam)
    }
    expect(at(3, seam - 1)).toBe(seam)
    expect(at(-3, seam)).toBe(seam - 1)
  }
})

test('the hollow centre cannot jump directly between Off and Always', () => {
  const { cx, cy } = PUBLIC_RIDE_ARC
  for (const previous of [0, 3]) {
    for (const dx of [-20, -1, 1, 20]) {
      expect(publicRideStableIndexAt(cx + dx, cy + 14, previous)).toBe(-1)
    }
  }
})

test('an active drag projects header touches onto the arc without extending its initial hit area', () => {
  const { cx, cy } = PUBLIC_RIDE_ARC
  expect(publicRideStableIndexAt(cx, -150, 0)).toBe(-1)
  expect(publicRideStableIndexAt(cx, -150, 0, true)).toBe(2)
  expect(publicRideStableIndexAt(cx - 350, cy - 40, 2, true)).toBe(0)
  expect(publicRideStableIndexAt(cx + 350, cy - 40, 0, true)).toBe(3)
})
