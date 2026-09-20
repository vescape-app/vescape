import { describe, expect, test } from 'bun:test'

import { getOneDarkMapStyle } from '@/modules/map/constants/oneDarkMapStyle'
import {
  getSatelliteDarkMapStyle,
  getSatelliteImageryPaint,
  getSatelliteOverlayMapStyle,
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

  test('uses the explicit theme contrast without restoring full-contrast imagery', () => {
    expect(getSatelliteImageryPaint(0.9, -0.1, -0.1)).toEqual({
      rasterOpacity: 0.9,
      rasterSaturation: -0.1,
      rasterContrast: -0.1,
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

  test('accepts a theme-matched background behind satellite tiles', () => {
    const style = JSON.parse(
      getSatelliteDarkMapStyle(true, true, false, true, 0.75, '#e8eef5'),
    ) as {
      layers: { id: string; paint: Record<string, unknown> }[]
    }

    expect(style.layers.find((layer) => layer.id === 'background')?.paint).toEqual({
      'background-color': '#e8eef5',
    })
  })

  test('overlay backdrop follows theme without changing road or label IDs', () => {
    const dark = JSON.parse(getSatelliteOverlayMapStyle('dark')) as {
      layers: { id: string; paint?: Record<string, unknown> }[]
    }
    const light = JSON.parse(getSatelliteOverlayMapStyle('light')) as typeof dark

    expect(dark.layers[0].paint?.['background-color']).toBe('#172033')
    expect(light.layers[0].paint?.['background-color']).toBe('#e8eef5')
    expect(light.layers.map((layer) => layer.id)).toEqual(dark.layers.map((layer) => layer.id))
    for (const road of dark.layers.filter(
      (layer) => layer.id.startsWith('road-') && layer.paint?.['line-color'],
    )) {
      expect(road.paint?.['line-color']).toBe('#ffffff')
      expect(light.layers.find((layer) => layer.id === road.id)?.paint?.['line-color']).toBe(
        '#000000',
      )
    }
  })

  test('satellite document keeps roads and labels without One Dark ground geometry', () => {
    const satellite = JSON.parse(getSatelliteDarkMapStyle(true, true, false, true)) as {
      layers: { id: string; type: string; source?: string; 'source-layer'?: string }[]
    }
    const streets = JSON.parse(getOneDarkMapStyle(true, true, false)) as {
      layers: { id: string }[]
    }
    const ids = satellite.layers.map((layer) => layer.id)

    expect(ids).toContain('road-path') // raster insertion anchor
    expect(ids).toContain('road-label')
    expect(ids).toContain('poi-label')
    expect(ids).toContain('transit-label')
    expect(satellite.layers.some((layer) => layer['source-layer'] === 'building')).toBe(false)
    expect(ids.some((id) => id.startsWith('landcover-') || id.startsWith('landuse-'))).toBe(false)
    expect(streets.layers.map((layer) => layer.id)).toContain('building')
    expect(streets.layers.map((layer) => layer.id)).toContain('building-outline')
  })
})
