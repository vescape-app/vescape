import { describe, expect, test } from 'bun:test'

import { routePreviewPath, routePreviewProjection } from './routePreview'

describe('route thumbnail geometry', () => {
  test('keeps a geographic square square inside a rectangular thumbnail', () => {
    const points = [
      { latitude: 60, longitude: 10 },
      { latitude: 60.001, longitude: 10.002 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    const a = project(points[0])
    const b = project(points[1])
    expect(b.x - a.x).toBeCloseTo(a.y - b.y, 5)
    expect((a.x + b.x) / 2).toBeCloseTo(37, 5)
    expect((a.y + b.y) / 2).toBeCloseTo(26, 5)
  })

  test('centres horizontal and stationary tracks without stretching GPS noise', () => {
    const points = [
      { latitude: 52, longitude: 18 },
      { latitude: 52, longitude: 18.01 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    expect(project(points[0])).toEqual({ x: 8, y: 26 })
    expect(project(points[1])).toEqual({ x: 66, y: 26 })
    expect(routePreviewProjection([points[0], points[0]], 74, 52)(points[0])).toEqual({
      x: 37,
      y: 26,
    })
  })

  test('starts another subpath after a gap and retains true endpoints', () => {
    const points = [
      { latitude: 52, longitude: 18 },
      { latitude: 52, longitude: 18.001 },
      { latitude: 52.001, longitude: 18.001, breakBefore: true },
      { latitude: 52.001, longitude: 18.002 },
    ]
    const path = routePreviewPath(points, 74, 52)!
    expect(path.match(/[ML]/g)).toEqual(['M', 'L', 'M', 'L'])
    const end = routePreviewProjection(points, 74, 52)(points[3])
    expect(path.endsWith(`L${end.x.toFixed(3)},${end.y.toFixed(3)}`)).toBe(true)
  })

  test('wraps longitude across the date line', () => {
    const points = [
      { latitude: 0, longitude: 179.999 },
      { latitude: 0.002, longitude: -179.999 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    const a = project(points[0]),
      b = project(points[1])
    expect(b.x - a.x).toBeCloseTo(a.y - b.y, 5)
  })
})
