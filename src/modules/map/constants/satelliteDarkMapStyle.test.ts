import { describe, expect, test } from 'bun:test'

import {
  getSatelliteDarkMapStyle,
  getSatelliteImageryPaint,
} from '@/modules/map/constants/satelliteDarkMapStyle'

describe('satellite dark map style', () => {
  test('keeps the style JSON stable while imagery paint changes at reveal time', () => {
    const telemetryStyle = getSatelliteDarkMapStyle(0.2, true, true, false, true, -0.35)
    const mapStyle = getSatelliteDarkMapStyle(0.2, true, true, false, true, -0.35)

    expect(mapStyle).toBe(telemetryStyle)
    expect(getSatelliteImageryPaint(0.2, -0.35)).toEqual({
      rasterOpacity: 0.2,
      rasterSaturation: -0.35,
      rasterContrast: -0.25,
    })
    expect(getSatelliteImageryPaint(1, 0)).toEqual({
      rasterOpacity: 1,
      rasterSaturation: 0,
      rasterContrast: 0,
    })
  })

  test('clamps imagery paint to Mapbox-supported ranges', () => {
    expect(getSatelliteImageryPaint(2, -2)).toEqual({
      rasterOpacity: 1,
      rasterSaturation: 0,
      rasterContrast: 0,
    })
    expect(getSatelliteImageryPaint(0, 2)).toEqual({
      rasterOpacity: 0.1,
      rasterSaturation: 1,
      rasterContrast: -0.25,
    })
  })

  test('stores satellite overlay paint in the style JSON', () => {
    const style = JSON.parse(
      getSatelliteDarkMapStyle(0.2, false, false, false, true, -0.35, 2),
    ) as {
      layers: {
        id: string
        paint?: Record<string, unknown>
      }[]
    }

    expect(style.layers.find((layer) => layer.id === 'satellite')?.paint).toMatchObject({
      'raster-opacity': 0.2,
      'raster-saturation': -0.35,
      'raster-contrast': -0.25,
    })
    expect(style.layers.find((layer) => layer.id === 'road-path')?.paint).toMatchObject({
      'line-opacity': 1,
    })
    expect(style.layers.some((layer) => layer.id === 'poi-label')).toBe(false)
    expect(style.layers.some((layer) => layer.id === 'transit-label')).toBe(false)
  })
})
