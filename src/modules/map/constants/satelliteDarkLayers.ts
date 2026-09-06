import { theme } from '@/constants/theme'

const SATELLITE_TEXT = theme.palette.mono.white
const SATELLITE_MUTED_TEXT = theme.palette.mono.white
const SATELLITE_HALO = 'hsl(0, 5%, 0%)'
const SATELLITE_SOFT_HALO = 'hsla(0, 5%, 0%, 0.75)'
const SATELLITE_ROAD = theme.palette.mono.white
const SATELLITE_PATH = theme.palette.mono.white

/** Thin white road casings, drawn over the imagery only when the rider asks for street lines. */
export function satelliteStreetLineLayers(showStreetLines: boolean, streetLineOpacity: number) {
  const clampedStreetLineOpacity = Math.max(0, Math.min(1, streetLineOpacity))
  return [
    ...(showStreetLines
      ? [
          {
            id: 'road-path',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['all', ['==', ['get', 'class'], 'path']],
            paint: {
              'line-color': SATELLITE_PATH,
              'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 18, 1.2],
              'line-dasharray': [2, 1.5],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-track',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['==', ['get', 'class'], 'track'],
            paint: {
              'line-color': SATELLITE_PATH,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.4, 18, 2],
              'line-dasharray': [3, 1.5],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-service',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['==', ['get', 'class'], 'service'],
            paint: {
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 18, 2],
              'line-opacity': clampedStreetLineOpacity,
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
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.35, 16, 1.8, 18, 3.4],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-secondary-tertiary',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: [
              'any',
              ['==', ['get', 'class'], 'secondary'],
              ['==', ['get', 'class'], 'tertiary'],
            ],
            paint: {
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.8, 18, 4.5],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-primary',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['==', ['get', 'class'], 'primary'],
            paint: {
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 14, 2.2, 18, 5.5],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-trunk',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['==', ['get', 'class'], 'trunk'],
            paint: {
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.8, 18, 6],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
          {
            id: 'road-motorway',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
            filter: ['==', ['get', 'class'], 'motorway'],
            paint: {
              'line-color': SATELLITE_ROAD,
              'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 12, 2.4, 18, 7],
              'line-opacity': clampedStreetLineOpacity,
            },
          },
        ]
      : []),
  ]
}

/** Points of interest and transit. Labels and icons are toggled independently. */
export function satellitePoiLayers(showPoiLabels: boolean, showPoiIcons: boolean) {
  return [
    ...(showPoiLabels || showPoiIcons
      ? [
          {
            id: 'poi-label',
            type: 'symbol',
            source: 'composite',
            'source-layer': 'poi_label',
            minzoom: 6,
            filter: ['<=', ['get', 'filterrank'], ['+', ['step', ['zoom'], 0, 16, 1, 17, 2], 3]],
            layout: {
              'text-size': [
                'step',
                ['zoom'],
                ['step', ['get', 'sizerank'], 18, 5, 12],
                17,
                ['step', ['get', 'sizerank'], 18, 13, 12],
              ],
              'icon-image': showPoiIcons
                ? [
                    'case',
                    ['has', 'maki_beta'],
                    ['coalesce', ['image', ['get', 'maki_beta']], ['image', ['get', 'maki']]],
                    ['image', ['get', 'maki']],
                  ]
                : '',
              'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              'text-offset': [
                'step',
                ['zoom'],
                ['step', ['get', 'sizerank'], ['literal', [0, 0]], 5, ['literal', [0, 0.8]]],
                17,
                ['step', ['get', 'sizerank'], ['literal', [0, 0]], 13, ['literal', [0, 0.8]]],
              ],
              'text-anchor': [
                'step',
                ['zoom'],
                ['step', ['get', 'sizerank'], 'center', 5, 'top'],
                17,
                ['step', ['get', 'sizerank'], 'center', 13, 'top'],
              ],
              'text-field': showPoiLabels ? ['coalesce', ['get', 'name_en'], ['get', 'name']] : '',
            },
            paint: {
              'icon-opacity': [
                'step',
                ['zoom'],
                ['step', ['get', 'sizerank'], 0, 5, 1],
                17,
                ['step', ['get', 'sizerank'], 0, 13, 1],
              ],
              'text-halo-color': 'hsl(0, 0%, 0%)',
              'text-halo-width': 0.5,
              'text-halo-blur': 0.5,
              'text-color': [
                'match',
                ['get', 'class'],
                'park_like',
                'hsl(110, 100%, 85%)',
                'education',
                'hsl(30, 100%, 85%)',
                'medical',
                'hsl(0, 100%, 85%)',
                SATELLITE_TEXT,
              ],
            },
          },
          {
            id: 'transit-label',
            type: 'symbol',
            source: 'composite',
            'source-layer': 'transit_stop_label',
            minzoom: 13,
            layout: {
              'text-size': 12,
              'icon-image': showPoiIcons ? ['get', 'network'] : '',
              'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              'text-justify': ['match', ['get', 'stop_type'], 'entrance', 'left', 'center'],
              'text-offset': [
                'match',
                ['get', 'stop_type'],
                'entrance',
                ['literal', [1, 0]],
                ['literal', [0, 0.8]],
              ],
              'text-anchor': ['match', ['get', 'stop_type'], 'entrance', 'left', 'top'],
              'text-field': showPoiLabels
                ? [
                    'step',
                    ['zoom'],
                    '',
                    13,
                    [
                      'match',
                      ['get', 'mode'],
                      ['literal', ['rail', 'metro_rail']],
                      ['coalesce', ['get', 'name_en'], ['get', 'name']],
                      '',
                    ],
                    14,
                    [
                      'match',
                      ['get', 'mode'],
                      ['literal', ['bus', 'bicycle']],
                      '',
                      ['coalesce', ['get', 'name_en'], ['get', 'name']],
                    ],
                    18,
                    ['coalesce', ['get', 'name_en'], ['get', 'name']],
                  ]
                : '',
              'text-letter-spacing': 0.01,
              'text-max-width': ['match', ['get', 'stop_type'], 'entrance', 15, 9],
            },
            paint: {
              'text-halo-color': 'hsl(0, 0%, 0%)',
              'text-color': 'hsl(204, 100%, 80%)',
              'text-halo-blur': 0.5,
              'text-halo-width': 0.5,
            },
          },
        ]
      : []),
  ]
}

/** Regions, towns and villages — the labels between country and city scale. */
export function satelliteDistrictLabelLayers(showDistrictLabels: boolean) {
  return [
    ...(showDistrictLabels
      ? [
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
              'text-color': SATELLITE_MUTED_TEXT,
              'text-halo-color': SATELLITE_HALO,
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
              'text-color': SATELLITE_TEXT,
              'text-halo-color': SATELLITE_SOFT_HALO,
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
              'text-color': SATELLITE_MUTED_TEXT,
              'text-halo-color': SATELLITE_HALO,
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
              'text-color': SATELLITE_MUTED_TEXT,
              'text-halo-color': SATELLITE_HALO,
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
              'text-color': SATELLITE_MUTED_TEXT,
              'text-halo-color': SATELLITE_HALO,
              'text-halo-width': 1,
              'text-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.25, 15, 0.45, 16, 0.62],
            },
          },
        ]
      : []),
  ]
}
