import { expect, test } from 'bun:test'
import { liveTrailParts } from './liveTrailPrefix'

const history: GeoJSON.Feature<GeoJSON.LineString> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [19, 50],
      [20, 51],
      [21, 52],
      [22, 53],
    ],
  },
}

test('only the newest two measured segments fade; body and dust share exactly one anchor', () => {
  const { body, tail } = liveTrailParts(history, { longitude: 23, latitude: 54 })
  expect(body?.geometry.coordinates).toEqual([
    [19, 50],
    [20, 51],
    [21, 52],
  ])
  expect(tail?.geometry.coordinates).toEqual([
    [21, 52],
    [22, 53],
    [23, 54],
  ])
  expect(history.geometry.coordinates).toHaveLength(4)
})

test('history catch-up leaves identical geometry instead of briefly losing the tail', () => {
  const raw = { longitude: 23, latitude: 54 }
  const before = liveTrailParts(history, raw)
  const caughtUp = {
    ...history,
    geometry: { ...history.geometry, coordinates: [...history.geometry.coordinates, [23, 54]] },
  }
  expect(liveTrailParts(caughtUp, raw)).toEqual(before)
})

test('short trails fade along available segments without degenerate lines or duplicate joins', () => {
  expect(liveTrailParts(null, { longitude: 21, latitude: 52 })).toEqual({ body: null, tail: null })
  const duplicate = {
    ...history,
    geometry: {
      ...history.geometry,
      coordinates: [
        [19, 50],
        [19, 50],
        [20, 51],
      ],
    },
  }
  expect(
    liveTrailParts(duplicate, { longitude: 20, latitude: 51 }).tail?.geometry.coordinates,
  ).toEqual([
    [19, 50],
    [20, 51],
  ])
  expect(liveTrailParts(duplicate, null).body).toBeNull()
})
