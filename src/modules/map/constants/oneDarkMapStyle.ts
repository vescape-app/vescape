import { theme } from '@/constants/theme'

export const ONE_DARK_MAP_STYLE = JSON.stringify({
  version: 8,
  name: 'One Dark',
  sprite: 'mapbox://sprites/mapbox/streets-v12',
  sources: {
    composite: {
      url: 'mapbox://mapbox.mapbox-streets-v8',
      type: 'vector',
    },
  },
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#172033' },
    },

    // --- landcover ---
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'crop']]],
      paint: {
        'fill-color': '#233b3f',
        'fill-opacity': 0.6,
      },
    },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
      paint: {
        'fill-color': '#1f363b',
        'fill-opacity': 0.7,
      },
    },
    {
      id: 'landcover-scrub',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'scrub'],
      paint: {
        'fill-color': '#22363d',
        'fill-opacity': 0.5,
      },
    },

    // --- landuse (parks, forests, cemeteries) ---
    {
      id: 'landuse-park',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'park'],
      paint: {
        'fill-color': '#203d42',
        'fill-opacity': 0.65,
      },
    },
    {
      id: 'landuse-park-outline',
      type: 'line',
      source: 'composite',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'park'],
      paint: {
        'line-color': '#0e7490',
        'line-width': 1.2,
        'line-opacity': 0.7,
      },
    },
    {
      id: 'landuse-forest',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['wood', 'forest', 'national_park', 'nature_reserve']],
      ],
      paint: {
        'fill-color': '#1d343b',
        'fill-opacity': 0.7,
      },
    },
    {
      id: 'landuse-forest-outline',
      type: 'line',
      source: 'composite',
      'source-layer': 'landuse',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['wood', 'forest', 'national_park', 'nature_reserve']],
      ],
      paint: {
        'line-color': '#0e7490',
        'line-width': 1,
        'line-opacity': 0.6,
      },
    },
    {
      id: 'landuse-cemetery',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'cemetery'],
      paint: {
        'fill-color': '#223044',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'landuse-hospital',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'hospital'],
      paint: {
        'fill-color': '#2b2f45',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'landuse-school',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'school'],
      paint: {
        'fill-color': '#273246',
        'fill-opacity': 0.5,
      },
    },

    // --- water ---
    {
      id: 'water',
      type: 'fill',
      source: 'composite',
      'source-layer': 'water',
      paint: {
        'fill-color': '#0c2a3f',
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'composite',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#0e3a58',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2, 18, 4],
      },
    },

    // --- roads ---
    {
      id: 'road-path',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['all', ['==', ['get', 'class'], 'path']],
      paint: {
        'line-color': '#53657b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 2],
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.7,
      },
    },
    {
      id: 'road-track',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'track'],
      paint: {
        'line-color': '#64748b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2.5, 18, 3.5],
        'line-dasharray': [3, 1.5],
        'line-opacity': 0.8,
      },
    },
    {
      id: 'road-service',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'service'],
      paint: {
        'line-color': '#334155',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 4],
      },
    },
    {
      id: 'road-street',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: [
        'any',
        ['==', ['get', 'class'], 'street'],
        ['==', ['get', 'class'], 'street_limited'],
      ],
      paint: {
        'line-color': '#334155',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 3, 18, 7],
      },
    },
    {
      id: 'road-secondary-tertiary',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['any', ['==', ['get', 'class'], 'secondary'], ['==', ['get', 'class'], 'tertiary']],
      paint: {
        'line-color': '#3f526b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 3, 18, 10],
      },
    },
    {
      id: 'road-primary',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'primary'],
      paint: {
        'line-color': '#46617c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 4, 18, 13],
      },
    },
    {
      id: 'road-trunk',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'trunk'],
      paint: {
        'line-color': '#4e6b86',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 3, 18, 14],
      },
    },
    {
      id: 'road-motorway',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'motorway'],
      paint: {
        'line-color': '#567491',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 4, 18, 16],
      },
    },

    // --- rail ---
    {
      id: 'road-rail',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: [
        'any',
        ['==', ['get', 'class'], 'major_rail'],
        ['==', ['get', 'class'], 'minor_rail'],
      ],
      paint: {
        'line-color': '#53657b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 1.5],
        'line-dasharray': [4, 2],
        'line-opacity': 0.6,
      },
    },

    // --- buildings ---
    {
      id: 'building',
      type: 'fill',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': '#263448',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.5, 16, 0.7],
      },
    },
    {
      id: 'building-outline',
      type: 'line',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'line-color': '#3b4f67',
        'line-width': 0.5,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.4],
      },
    },

    // --- admin boundaries ---
    {
      id: 'admin-1-boundary',
      type: 'line',
      source: 'composite',
      'source-layer': 'admin',
      filter: ['==', ['get', 'admin_level'], 1],
      paint: {
        'line-color': '#53657b',
        'line-width': 1.2,
        'line-dasharray': [4, 3],
        'line-opacity': 0.5,
      },
    },
    {
      id: 'admin-0-boundary',
      type: 'line',
      source: 'composite',
      'source-layer': 'admin',
      filter: ['all', ['==', ['get', 'admin_level'], 0], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': '#7890a8',
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    },

    // --- labels ---
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
        'text-color': theme.palette.sky.color,
        'text-halo-color': theme.palette.sky.bg,
        'text-halo-width': 1,
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
        'text-color': '#8ba4bf',
        'text-halo-color': '#172033',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'poi-label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'poi_label',
      minzoom: 6,
      filter: ['<=', ['get', 'filterrank'], ['+', ['step', ['zoom'], 0, 16, 1, 17, 2], 3]],
      layout: {
        'icon-image': [
          'coalesce',
          [
            'case',
            ['has', 'maki_beta'],
            ['coalesce', ['image', ['get', 'maki_beta']], ['image', ['get', 'maki']]],
            ['image', ['get', 'maki']],
          ],
          [
            'image',
            [
              'match',
              ['get', 'class'],
              'park_like',
              'park',
              'education',
              'school',
              'medical',
              'hospital',
              'parking',
              'parking',
              'place_of_worship',
              'place-of-worship',
              'sport_and_leisure',
              'pitch',
              '',
            ],
          ],
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.75, 18, 1],
        'icon-allow-overlap': false,
        'icon-padding': 3,
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': ['literal', [0, 1.15]],
        'text-anchor': 'top',
      },
      paint: {
        'icon-color': '#8ba4bf',
        'icon-halo-width': 0,
        'icon-opacity': 0.76,
        'text-color': '#7890a8',
        'text-halo-color': '#172033',
        'text-halo-width': 1,
      },
    },
    {
      id: 'transit-label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'transit_stop_label',
      minzoom: 13,
      layout: {
        'icon-image': [
          'image',
          [
            'match',
            ['get', 'mode'],
            'bus',
            'bus',
            'tram',
            'rail-light',
            ['literal', ['rail', 'metro_rail']],
            'rail',
            'ferry',
            'ferry',
            'bus',
          ],
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.75, 18, 1],
        'icon-allow-overlap': false,
        'icon-padding': 3,
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': ['literal', [0, 1.15]],
        'text-anchor': 'top',
      },
      paint: {
        'icon-color': '#8ba4bf',
        'icon-halo-width': 0,
        'icon-opacity': 0.76,
        'text-color': '#7890a8',
        'text-halo-color': '#172033',
        'text-halo-width': 1,
      },
    },
    {
      id: 'place-label-region',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 3,
      maxzoom: 9,
      filter: [
        'any',
        ['==', ['get', 'class'], 'state'],
        ['==', ['get', 'class'], 'province'],
        ['==', ['get', 'type'], 'state'],
        ['==', ['get', 'type'], 'province'],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 7, 13, 9, 15],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-padding': 16,
      },
      paint: {
        'text-color': '#718096',
        'text-halo-color': '#172033',
        'text-halo-width': 1.5,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 6, 0.72, 9, 0.4],
      },
    },
    {
      id: 'place-label-subdivision',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 8,
      filter: [
        'any',
        ['==', ['get', 'class'], 'settlement_subdivision'],
        ['==', ['get', 'type'], 'settlement_subdivision'],
        ['==', ['get', 'type'], 'suburb'],
        ['==', ['get', 'type'], 'neighbourhood'],
        ['==', ['get', 'type'], 'neighborhood'],
        ['==', ['get', 'type'], 'quarter'],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 8, 12, 11, 15, 13],
        'text-padding': 18,
      },
      paint: {
        'text-color': '#6f8197',
        'text-halo-color': '#172033',
        'text-halo-width': 1.2,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 0.68, 15, 0.78],
      },
    },
    {
      id: 'place-label-town',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 8,
      filter: ['==', ['get', 'type'], 'town'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 14],
        'text-padding': 8,
      },
      paint: {
        'text-color': '#8fa1b5',
        'text-halo-color': '#172033',
        'text-halo-width': 1.5,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 10, 0.78, 14, 0.9],
      },
    },
    {
      id: 'place-label-village',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 11,
      filter: ['==', ['get', 'type'], 'village'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 8, 15, 11],
        'text-padding': 14,
      },
      paint: {
        'text-color': '#73869b',
        'text-halo-color': '#172033',
        'text-halo-width': 1.2,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 13, 0.55, 15, 0.72],
      },
    },
    {
      id: 'place-label-hamlet',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 13,
      filter: ['==', ['get', 'type'], 'hamlet'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 7.5, 16, 10],
        'text-padding': 18,
      },
      paint: {
        'text-color': '#64758a',
        'text-halo-color': '#172033',
        'text-halo-width': 1,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.25, 15, 0.45, 16, 0.62],
      },
    },
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
        'text-color': '#abb2bf',
        'text-halo-color': '#172033',
        'text-halo-width': 2,
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
        'text-color': '#8ba4bf',
        'text-halo-color': '#172033',
        'text-halo-width': 2,
      },
    },
  ],
} as const)

interface OneDarkStyleLayer {
  id?: string
  layout?: Record<string, unknown>
  [key: string]: unknown
}

const ONE_DARK_MAP_STYLE_OBJECT = JSON.parse(ONE_DARK_MAP_STYLE) as {
  layers?: OneDarkStyleLayer[]
}

const DISTRICT_LABEL_LAYER_IDS = new Set([
  'place-label-region',
  'place-label-subdivision',
  'place-label-town',
  'place-label-village',
  'place-label-hamlet',
])

const POI_LAYER_IDS = new Set(['poi-label', 'transit-label'])

function filterOneDarkLabels(
  showPoiLabels: boolean,
  showPoiIcons: boolean,
  showDistrictLabels: boolean,
) {
  return JSON.stringify({
    ...ONE_DARK_MAP_STYLE_OBJECT,
    layers:
      ONE_DARK_MAP_STYLE_OBJECT.layers
        ?.filter((layer) => {
          if (!showPoiLabels && !showPoiIcons && layer.id && POI_LAYER_IDS.has(layer.id))
            return false
          if (!showDistrictLabels && layer.id && DISTRICT_LABEL_LAYER_IDS.has(layer.id))
            return false
          return true
        })
        .map((layer) => {
          if (!layer.id || !POI_LAYER_IDS.has(layer.id)) return layer
          return {
            ...layer,
            layout: {
              ...layer.layout,
              ...(!showPoiLabels && { 'text-field': '' }),
              ...(!showPoiIcons && { 'icon-image': '' }),
            },
          }
        }) ?? [],
  })
}

export function getOneDarkMapStyle(
  showPoiLabels = true,
  showPoiIcons = true,
  showDistrictLabels = true,
) {
  if (showPoiLabels && showPoiIcons && showDistrictLabels) return ONE_DARK_MAP_STYLE
  return filterOneDarkLabels(showPoiLabels, showPoiIcons, showDistrictLabels)
}
