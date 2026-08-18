import {
  satelliteDistrictLabelLayers,
  satellitePoiLayers,
  satelliteStreetLineLayers,
} from '@/modules/map/constants/satelliteDarkLayers'
import { theme } from '@/constants/theme'

export const DEFAULT_SATELLITE_IMAGERY_OPACITY = 0.2
export const DEFAULT_SATELLITE_MAP_IMAGERY_OPACITY = 1
export const DEFAULT_SATELLITE_IMAGERY_SATURATION = -0.35

const SATELLITE_TEXT = theme.palette.mono.white
const SATELLITE_MUTED_TEXT = theme.palette.mono.white
const SATELLITE_HALO = 'hsl(0, 5%, 0%)'
const SATELLITE_SOFT_HALO = 'hsla(0, 5%, 0%, 0.75)'
const FULL_IMAGERY_OPACITY = 1

export function getSatelliteImageryPaint(
  imageryOpacity = DEFAULT_SATELLITE_IMAGERY_OPACITY,
  imagerySaturation = DEFAULT_SATELLITE_IMAGERY_SATURATION,
) {
  const clampedImageryOpacity = Math.max(0.1, Math.min(1, imageryOpacity))
  const clampedImagerySaturation = Math.max(-1, Math.min(1, imagerySaturation))
  const toneSatelliteImage = clampedImageryOpacity < FULL_IMAGERY_OPACITY
  return {
    rasterOpacity: clampedImageryOpacity,
    rasterSaturation: toneSatelliteImage ? clampedImagerySaturation : 0,
    rasterContrast: toneSatelliteImage ? -0.25 : 0,
  }
}

export function getSatelliteDarkMapStyle(
  imageryOpacity = DEFAULT_SATELLITE_IMAGERY_OPACITY,
  showPoiLabels = true,
  showPoiIcons = true,
  showDistrictLabels = true,
  showStreetLines = false,
  imagerySaturation = DEFAULT_SATELLITE_IMAGERY_SATURATION,
  streetLineOpacity = 0.8,
) {
  const satelliteImageryPaint = getSatelliteImageryPaint(imageryOpacity, imagerySaturation)

  return JSON.stringify({
    version: 8,
    name: 'Satellite Dark',
    sprite: 'mapbox://sprites/mapbox/satellite-streets-v12',
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sources: {
      satellite: {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tileSize: 256,
      },
      composite: {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v8',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme.palette.slate.surfaceDeep },
      },
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        paint: {
          'raster-opacity': satelliteImageryPaint.rasterOpacity,
          'raster-saturation': satelliteImageryPaint.rasterSaturation,
          'raster-contrast': satelliteImageryPaint.rasterContrast,
        },
      },
      ...satelliteStreetLineLayers(showStreetLines, streetLineOpacity),
      {
        id: 'water-label',
        type: 'symbol',
        source: 'composite',
        'source-layer': 'natural_label',
        filter: ['==', ['get', 'class'], 'water'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
        },
        paint: {
          'text-color': 'hsl(240, 68%, 90%)',
          'text-halo-color': 'hsla(0, 0%, 0%, 0.5)',
          'text-halo-width': 1,
          'text-halo-blur': 1,
        },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'composite',
        'source-layer': 'road',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 18, 13],
          'symbol-placement': 'line',
          'text-max-angle': 30,
        },
        paint: {
          'text-color': SATELLITE_TEXT,
          'text-halo-color': SATELLITE_HALO,
          'text-halo-width': 1,
          'text-halo-blur': 1,
        },
      },
      ...satellitePoiLayers(showPoiLabels, showPoiIcons),
      ...satelliteDistrictLabelLayers(showDistrictLabels),
      {
        id: 'place-label-city',
        type: 'symbol',
        source: 'composite',
        'source-layer': 'place_label',
        filter: ['==', ['get', 'type'], 'city'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 18, 14, 22],
        },
        paint: {
          'text-color': SATELLITE_MUTED_TEXT,
          'text-halo-color': SATELLITE_HALO,
          'text-halo-width': 1,
          'text-halo-blur': 1,
        },
      },
      {
        id: 'place-label-country',
        type: 'symbol',
        source: 'composite',
        'source-layer': 'place_label',
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 16],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
        },
        paint: {
          'text-color': SATELLITE_MUTED_TEXT,
          'text-halo-color': SATELLITE_SOFT_HALO,
          'text-halo-width': 1.25,
        },
      },
    ],
  })
}
