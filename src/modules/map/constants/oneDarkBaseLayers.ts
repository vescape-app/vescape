/** One Dark ground layers: terrain, water, roads, rail and buildings — everything under labels. */
export const ONE_DARK_BASE_LAYERS = [
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
    filter: ['any', ['==', ['get', 'class'], 'street'], ['==', ['get', 'class'], 'street_limited']],
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
    filter: ['any', ['==', ['get', 'class'], 'major_rail'], ['==', ['get', 'class'], 'minor_rail']],
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
]
