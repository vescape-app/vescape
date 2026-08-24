import { describe, expect, test } from 'bun:test'

import {
  getSatelliteDarkMapStyle,
  getSatelliteImageryPaint,
} from '@/modules/map/constants/satelliteDarkMapStyle'

describe('satellite dark map style', () => {
  test('keeps the style JSON stable while imagery paint changes at reveal time', () => {
    const telemetryStyle = getSatelliteDarkMapStyle(true, true, false, true)
    const mapStyle = getSatelliteDarkMapStyle(true, true, false, true)

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

  test('leaves imagery out of the style JSON so the owned raster layer owns it', () => {
    const style = JSON.parse(getSatelliteDarkMapStyle(false, false, false, true, 2)) as {
      sources: Record<string, unknown>
      layers: {
        id: string
        paint?: Record<string, unknown>
      }[]
    }

    // #423: the imagery is mounted as an owned RasterSource/RasterLayer instead, because an
    // `existing` layer adopted from this JSON never receives paint updates on iOS Release builds.
    expect(style.layers.some((layer) => layer.id === 'satellite')).toBe(false)
    expect(style.sources.satellite).toBeUndefined()
    expect(style.layers.find((layer) => layer.id === 'road-path')?.paint).toMatchObject({
      'line-opacity': 1,
    })
    expect(style.layers.some((layer) => layer.id === 'poi-label')).toBe(false)
    expect(style.layers.some((layer) => layer.id === 'transit-label')).toBe(false)
  })
})
