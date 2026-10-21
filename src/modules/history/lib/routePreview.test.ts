import { describe, expect, test } from 'bun:test'

import { routePreviewPath, routePreviewProjection, routePreviewTiles } from './routePreview'

describe('route thumbnail geometry', () => {
  test('keeps a geographic square square inside a rectangular thumbnail', () => {
    const points = [
      { latitude: 60, longitude: 10 },
      { latitude: 60.001, longitude: 10.002 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    const a = project(points[0])
    const b = project(points[1])
    // Web Mercator, like the map tiles behind it: square to within its scale change across 100 m.
    expect(b.x - a.x).toBeCloseTo(a.y - b.y, 2)
    expect((a.x + b.x) / 2).toBeCloseTo(37, 5)
    expect((a.y + b.y) / 2).toBeCloseTo(26, 5)
  })

  test('centres horizontal and stationary tracks without stretching GPS noise', () => {
    const points = [
      { latitude: 52, longitude: 18 },
      { latitude: 52, longitude: 18.01 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    expect(project(points[0]).x).toBeCloseTo(8, 5)
    expect(project(points[0]).y).toBeCloseTo(26, 5)
    expect(project(points[1]).x).toBeCloseTo(66, 5)
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

  test('keeps a short ride at street scale instead of filling the thumbnail', () => {
    const points = [
      { latitude: 51.1, longitude: 17.03 },
      { latitude: 51.1, longitude: 17.0303 },
    ]
    const project = routePreviewProjection(points, 74, 52)
    // ~21 m of riding inside a 300 m minimum span.
    expect(project(points[1]).x - project(points[0]).x).toBeLessThan(5)
  })
})

describe('route thumbnail map tiles', () => {
  const ride = [
    { latitude: 51.1, longitude: 17.0 },
    { latitude: 51.12, longitude: 17.05 },
  ]

  test('cover the whole thumbnail with tiles that are only ever scaled down', () => {
    const tiles = routePreviewTiles(ride, 74, 52, 3)
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) expect(tile.size * 3).toBeLessThanOrEqual(512)
    expect(tiles[0].size * 3).toBeGreaterThan(256)
    expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0)
    expect(Math.min(...tiles.map((tile) => tile.top))).toBeLessThanOrEqual(0)
    expect(Math.max(...tiles.map((tile) => tile.left + tile.size))).toBeGreaterThanOrEqual(74)
    expect(Math.max(...tiles.map((tile) => tile.top + tile.size))).toBeGreaterThanOrEqual(52)
  })

  test('place the route on the tile it falls in', () => {
    const tiles = routePreviewTiles(ride, 74, 52, 3)
    const start = routePreviewProjection(ride, 74, 52)(ride[0])
    const z = tiles[0].z
    const tileX = Math.floor(((ride[0].longitude + 180) / 360) * 2 ** z)
    const tile = tiles.find(
      (candidate) =>
        candidate.x === tileX &&
        start.x >= candidate.left &&
        start.x < candidate.left + candidate.size &&
        start.y >= candidate.top &&
        start.y < candidate.top + candidate.size,
    )
    expect(tile).toBeDefined()
  })

  test('wrap tile columns across the date line', () => {
    const points = [
      { latitude: 0, longitude: 179.999 },
      { latitude: 0.002, longitude: -179.999 },
    ]
    const tiles = routePreviewTiles(points, 74, 52, 3)
    const count = 2 ** tiles[0].z
    const columns = new Set(tiles.map((tile) => tile.x))
    expect(columns.has(0)).toBe(true)
    expect(columns.has(count - 1)).toBe(true)
  })
})
