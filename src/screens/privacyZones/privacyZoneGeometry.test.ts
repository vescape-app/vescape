import { describe, expect, test } from 'bun:test'

import { makeCircleFeature } from '@/helpers/mapGeometry'
import { radiusFromZoom, zoomFromRadius } from './privacyZoneGeometry'

function horizontalOffsetPx(longitude: number, centerLongitude: number, zoom: number) {
  return ((longitude - centerLongitude) / 360) * 512 * 2 ** zoom
}

describe('Privacy Zone editor and saved map boundary', () => {
  test('saving the setup circle preserves its geographic edge on the map', () => {
    for (const latitude of [0, 52.23, -70]) {
      for (const zoom of [12, 15, 18]) {
        const circleRadiusPx = 120
        const radiusMeters = Math.round(radiusFromZoom(zoom, circleRadiusPx, latitude))
        const circle = makeCircleFeature(21, latitude, radiusMeters)
        const east = circle.geometry.coordinates[0][16]
        const edgePx = horizontalOffsetPx(east[0], 21, zoom)
        const halfMeterPx = horizontalOffsetPx(
          makeCircleFeature(21, latitude, 0.5).geometry.coordinates[0][16][0],
          21,
          zoom,
        )
        expect(Math.abs(edgePx - circleRadiusPx)).toBeLessThan(halfMeterPx + 0.001)
      }
    }
  })

  test('reopening different saved radii fits the same geographic boundary to the circle', () => {
    for (const latitude of [0, 52.23, -70]) {
      for (const radiusMeters of [50, 200, 1000]) {
        const zoom = zoomFromRadius(radiusMeters, 120, latitude)
        const east = makeCircleFeature(21, latitude, radiusMeters).geometry.coordinates[0][16]
        expect(horizontalOffsetPx(east[0], 21, zoom)).toBeCloseTo(120, 3)
      }
    }
  })
})
