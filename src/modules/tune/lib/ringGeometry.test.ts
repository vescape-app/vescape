import { describe, expect, test } from 'bun:test'
import {
  constrainCircleEdit,
  handleCircle,
  ringPageRevealOffset,
  valueRadius,
} from './ringGeometry'

describe('Rings paging geometry', () => {
  test('adjacent reference circles reveal 36 px on both edges across phone/tablet widths', () => {
    for (const viewport of [280, 320, 360, 393, 412, 440, 600, 768, 1024, 1366]) {
      const size = Math.min(viewport - 24, 420)
      const radius = size * 0.36
      const offset = ringPageRevealOffset(viewport, radius)
      const rightNeighborLeftEdge = viewport * 1.5 - offset - radius
      const leftNeighborRightEdge = -viewport * 0.5 + offset + radius
      expect(viewport - rightNeighborLeftEdge).toBeCloseTo(36)
      expect(leftNeighborRightEdge).toBeCloseTo(36)
      // The settled current chart stays centered, with a gap to its neighbors.
      expect(viewport / 2 - radius).toBeGreaterThan(36)
    }
  })
})

describe('Rings coherent gestures', () => {
  test('translation stops the entire circle at the first limit and preserves its radius', () => {
    const radius = 144
    const center = 200
    const initial = handleCircle([50, 50, 50], radius, center)
    const next = constrainCircleEdit(
      initial,
      { ...initial, cx: initial.cx + 300 },
      radius,
      center,
      [0.001, 0.001, 0.001],
      0,
    )!
    expect(next.slice(0, 3).every((v) => v >= 0 && v <= 100)).toBe(true)
    const result = handleCircle(next, radius, center)
    expect(result.r).toBeCloseTo(initial.r, 2)
    expect(result.cy).toBeCloseTo(initial.cy, 2)
    expect(result.cx).toBeLessThan(initial.cx + 300)
  })
  test('resize with a rebased zero delta preserves unequal axis values', () => {
    const initial = handleCircle([21, 67, 84], 144, 200)
    const next = constrainCircleEdit(initial, initial, 144, 200, [1, 1, 1], 0)!
    expect(next.slice(0, 3)).toEqual([21, 67, 84])
    expect(valueRadius(75, 144) - valueRadius(50, 144)).toBe(
      valueRadius(50, 144) - valueRadius(25, 144),
    )
  })
})
