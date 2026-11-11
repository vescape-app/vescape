/**
 * Spike #656: One Dark on the OpenMapTiles schema served by OpenFreeMap, for MapLibre.
 *
 * Paint, zoom ramps and label sizes are read from the Mapbox One Dark layers by id, so the palette
 * has one source. Only the source, `source-layer`, filters, field names and fonts are translated.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native'
import { ONE_DARK_BASE_LAYERS } from '@/modules/map/constants/oneDarkBaseLayers'
import { ONE_DARK_OVERLAY_LAYERS } from '@/modules/map/constants/oneDarkOverlayLayers'
import { theme, type ResolvedTheme } from '@/constants/theme'
import { BLANK_STYLE, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import { getSatelliteDarkMapStyle } from '@/modules/map/constants/satelliteDarkMapStyle'

type Expression = unknown[]

interface StyleLayer {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
  filter?: Expression
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

const SOURCE = 'openmaptiles'

const FONT_REGULAR = [...theme.map.fontRegular]
const FONT_BOLD = [...theme.map.fontBold]
const FONT_ITALIC = [...theme.map.fontItalic]

const MAPBOX_LAYERS = [...ONE_DARK_BASE_LAYERS, ...ONE_DARK_OVERLAY_LAYERS] as StyleLayer[]

function mapboxLayer(id: string): StyleLayer {
  const layer = MAPBOX_LAYERS.find((candidate) => candidate.id === id)
  if (!layer) throw new Error(`One Dark layer ${id} not found`)
  return layer
}

/** Port one Mapbox layer: keep its type, zooms and paint; swap source, source-layer and filter. */
function port(
  mapboxId: string,
  sourceLayer: string,
  filter?: Expression,
  overrides: Partial<StyleLayer> = {},
): StyleLayer {
  const { id, type, minzoom, maxzoom, layout, paint } = mapboxLayer(mapboxId)
  return {
    id,
    type,
    source: SOURCE,
    'source-layer': sourceLayer,
    ...(minzoom !== undefined && { minzoom }),
    ...(maxzoom !== undefined && { maxzoom }),
    ...(filter && { filter }),
    ...(layout && { layout }),
    ...(paint && { paint }),
    ...overrides,
  }
}

/** Port a symbol layer and swap its DIN Pro stack for a Noto Sans stack OpenFreeMap serves. */
function portLabel(
  mapboxId: string,
  sourceLayer: string,
  filter: Expression | undefined,
  font: string[],
  layout: Record<string, unknown> = {},
): StyleLayer {
  const ported = port(mapboxId, sourceLayer, filter)
  return { ...ported, layout: { ...ported.layout, 'text-font': font, ...layout } }
}

const classIn = (...classes: string[]): Expression => [
  'match',
  ['get', 'class'],
  classes,
  true,
  false,
]
const subclassIn = (...subclasses: string[]): Expression => [
  'match',
  ['get', 'subclass'],
  subclasses,
  true,
  false,
]
const isLine: Expression = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
]
const isPoint: Expression = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
/** Mapbox's `motorway_link`, `trunk_link`… classes were never drawn; OpenMapTiles flags them `ramp`. */
const notRamp: Expression = ['!=', ['get', 'ramp'], 1]
const roadClass = (...classes: string[]): Expression => [
  'all',
  isLine,
  notRamp,
  classIn(...classes),
]

const PARK_SUBCLASSES = ['park', 'garden', 'recreation_ground', 'village_green']

const GROUND_LAYERS: StyleLayer[] = [
  { id: 'background', type: 'background', paint: mapboxLayer('background').paint },

  // landcover: Mapbox `landcover` classes grass/crop/wood/scrub
  port('landcover-grass', 'landcover', [
    'all',
    // Mapbox's `crop` is near-empty in its tiles; OpenMapTiles farmland would tint whole regions.
    classIn('grass'),
    ['!', subclassIn(...PARK_SUBCLASSES, 'scrub', 'heath')],
  ]),
  port('landcover-wood', 'landcover', classIn('wood')),
  port('landcover-scrub', 'landcover', subclassIn('scrub', 'heath')),

  // Mapbox `landuse=park` is leisure=park; OpenMapTiles puts it in landcover grass/park.
  port('landuse-park', 'landcover', subclassIn(...PARK_SUBCLASSES)),
  port('landuse-park-outline', 'landcover', subclassIn(...PARK_SUBCLASSES)),
  // Mapbox `landuse` wood/forest/national_park/nature_reserve: forests live in landcover, protected
  // areas in the `park` layer. Its `protected_area` class is left out: it can cover whole cities.
  port('landuse-forest', 'landcover', classIn('wood')),
  port('landuse-forest-outline', 'landcover', classIn('wood')),
  port('landuse-forest', 'park', classIn('national_park', 'nature_reserve'), {
    id: 'park-protected',
  }),
  port('landuse-forest-outline', 'park', classIn('national_park', 'nature_reserve'), {
    id: 'park-protected-outline',
  }),
  port('landuse-cemetery', 'landuse', classIn('cemetery')),
  port('landuse-hospital', 'landuse', classIn('hospital')),
  port('landuse-school', 'landuse', classIn('school', 'university', 'college', 'kindergarten')),

  port('water', 'water', ['!=', ['get', 'brunnel'], 'tunnel']),
  port('waterway', 'waterway', ['!=', ['get', 'brunnel'], 'tunnel']),

  port('road-path', 'transportation', roadClass('path')),
  port('road-track', 'transportation', roadClass('track')),
  port('road-service', 'transportation', roadClass('service')),
  port('road-street', 'transportation', roadClass('minor')),
  port('road-secondary-tertiary', 'transportation', roadClass('secondary', 'tertiary')),
  port('road-primary', 'transportation', roadClass('primary')),
  port('road-trunk', 'transportation', roadClass('trunk')),
  port('road-motorway', 'transportation', roadClass('motorway')),
  // Mapbox major_rail/minor_rail → OpenMapTiles rail (mainline) and transit (tram, light rail).
  port('road-rail', 'transportation', ['all', isLine, classIn('rail', 'transit')]),

  port('building', 'building'),
  port('building-outline', 'building'),
  // The main map adds this as a FillExtrusionLayer over the style (MainMapLayers.tsx).
  {
    id: 'building-3d',
    type: 'fill-extrusion',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!', ['has', 'hide_3d']],
    paint: {
      'fill-extrusion-color': theme.map.buildingDark,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.65,
      'fill-extrusion-vertical-gradient': true,
    },
  },
]

const name = ['get', 'name']
const placeClass = (...classes: string[]) => classIn(...classes)

const OVERLAY_LAYERS: StyleLayer[] = [
  // Mapbox admin_level 0/1 → OpenMapTiles admin_level 2 (country) / 4 (state).
  port('admin-1-boundary', 'boundary', [
    'all',
    ['==', ['get', 'admin_level'], 4],
    ['!=', ['get', 'maritime'], 1],
  ]),
  port('admin-0-boundary', 'boundary', [
    'all',
    ['==', ['get', 'admin_level'], 2],
    ['!=', ['get', 'maritime'], 1],
  ]),

  // Mapbox natural_label class=water covers lakes, seas and rivers; OpenMapTiles splits them into
  // water_name (bodies) and waterway (named rivers).
  portLabel('water-label', 'water_name', undefined, FONT_ITALIC, { 'text-field': name }),
  {
    ...portLabel('water-label', 'waterway', ['all', isLine, ['has', 'name']], FONT_ITALIC, {
      'text-field': name,
      'symbol-placement': 'line',
    }),
    id: 'waterway-label',
    minzoom: 12,
  },
  portLabel('road-label', 'transportation_name', isLine, FONT_REGULAR, { 'text-field': name }),
  // Mapbox filterrank 0..5 (lower = more important) ↔ OpenMapTiles rank 1..n per tile. The sprite
  // names icons by OpenMapTiles poi class, which is also what liberty uses.
  portLabel(
    'poi-label',
    'poi',
    [
      'all',
      isPoint,
      // Post boxes and parcel lockers outrank shops in OpenMapTiles; Mapbox hides them.
      ['!', classIn('bus', 'railway', 'ferry_terminal', 'post')],
      ['<=', ['get', 'rank'], ['step', ['zoom'], 2, 15, 6, 16, 12, 17, 24]],
    ],
    FONT_REGULAR,
    {
      'icon-image': ['coalesce', ['image', ['get', 'subclass']], ['image', ['get', 'class']]],
      'text-field': name,
    },
  ),
  // Mapbox transit_stop_label → OpenMapTiles poi with class bus/railway/ferry_terminal. Mapbox
  // One Dark shows stations, not every bus and tram stop, so stops wait until z17.
  portLabel(
    'transit-label',
    'poi',
    [
      'all',
      isPoint,
      classIn('bus', 'railway', 'ferry_terminal'),
      ['any', ['>=', ['zoom'], 17], ['!', subclassIn('bus_stop', 'tram_stop')]],
    ],
    FONT_REGULAR,
    {
      'icon-image': [
        'match',
        ['get', 'subclass'],
        'tram_stop',
        'railway_light',
        'subway',
        'railway_metro',
        ['match', ['get', 'class'], 'bus', 'bus', 'ferry_terminal', 'ferry', 'railway'],
      ],
      'text-field': name,
    },
  ),
  // Mapbox place_label `type` → OpenMapTiles place `class`.
  portLabel('place-label-region', 'place', placeClass('state', 'province'), FONT_REGULAR, {
    'text-field': name,
  }),
  portLabel(
    'place-label-subdivision',
    'place',
    placeClass('suburb', 'quarter', 'neighbourhood'),
    FONT_REGULAR,
    { 'text-field': name },
  ),
  portLabel('place-label-town', 'place', placeClass('town'), FONT_REGULAR, { 'text-field': name }),
  portLabel('place-label-village', 'place', placeClass('village'), FONT_REGULAR, {
    'text-field': name,
  }),
  portLabel(
    'place-label-hamlet',
    'place',
    placeClass('hamlet', 'isolated_dwelling'),
    FONT_REGULAR,
    {
      'text-field': name,
    },
  ),
  portLabel('place-label-city', 'place', placeClass('city'), FONT_BOLD, { 'text-field': name }),
  portLabel('place-label-country', 'place', placeClass('country'), FONT_BOLD, {
    'text-field': name,
  }),
]

const OPENMAPTILES_SOURCES = {
  [SOURCE]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
}
/** Every variant carries sprite and glyphs, so app symbol layers render on any of them. */
const STYLE_RESOURCES = {
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
}

/** One Dark for MapLibre on OpenFreeMap tiles. No Mapbox URL, no token. */
export const ONE_DARK_OPENMAPTILES_STYLE = {
  version: 8,
  name: 'One Dark (OpenMapTiles)',
  sources: OPENMAPTILES_SOURCES,
  ...STYLE_RESOURCES,
  layers: [...GROUND_LAYERS, ...OVERLAY_LAYERS],
}

const OPENMAPTILES_LAYERS = new Map(
  ONE_DARK_OPENMAPTILES_STYLE.layers.map((layer) => [layer.id, layer]),
)
const DETAIL_LAYER_IDS = new Set(['poi-label', 'transit-label'])

/** A paint or layout change to one layer of a loaded style, applied in place by the map. */
export interface StyleLayerUpdate {
  layerId: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

const detailsLayout = (detailsVisible: boolean) => ({
  visibility: detailsVisible ? 'visible' : 'none',
})

/** Points of interest and transit stops follow the mode; the rest of the map does not. */
function withDetails(layer: StyleLayer, detailsVisible: boolean): StyleLayer {
  if (!DETAIL_LAYER_IDS.has(layer.id)) return layer
  return { ...layer, layout: { ...layer.layout, ...detailsLayout(detailsVisible) } }
}

/**
 * The style documents below carry the initial values of everything the main map changes at
 * runtime; the map then changes those in place with these updates, so only a different base map
 * reloads the style.
 */
export function buildOneDarkStyle({ detailsVisible }: { detailsVisible: boolean }) {
  return {
    ...ONE_DARK_OPENMAPTILES_STYLE,
    layers: ONE_DARK_OPENMAPTILES_STYLE.layers.map((layer) =>
      withDetails(
        DETAIL_LAYER_IDS.has(layer.id)
          ? { ...layer, paint: { ...layer.paint, 'icon-opacity': 0.76, 'icon-halo-width': 0 } }
          : layer,
        detailsVisible,
      ),
    ),
  }
}

interface SatelliteImagery {
  opacity: number
  saturation: number
  contrast: number
}

const SATELLITE_IMAGERY_LAYER_ID = 'satellite-imagery'
const imageryPaint = (imagery: SatelliteImagery) => ({
  'raster-opacity': imagery.opacity,
  'raster-saturation': imagery.saturation,
  'raster-contrast': imagery.contrast,
})
/** Eases the imagery between telemetry dimming and the full map. */
const IMAGERY_TRANSITION = { duration: 260, delay: 0 }

/** Street lines of the satellite variant; their opacity follows the mode. */
const SATELLITE_ROAD_LINE_LAYER_IDS = (
  JSON.parse(getSatelliteDarkMapStyle(true, true, false, true)) as { layers: StyleLayer[] }
).layers
  .filter((layer) => layer.type === 'line' && layer.id.startsWith('road-'))
  .map((layer) => layer.id)

/** OpenFreeMap liberty, the light base map: its POI layers and its first label layer. */
const LIGHT_STYLE_DETAIL_LAYER_IDS = ['poi_r20', 'poi_r7', 'poi_r1', 'poi_transit']
const LIGHT_STYLE_FIRST_LABEL_LAYER_ID = 'road_one_way_arrow'

/**
 * First label layer of a base style: app fills go below it so labels stay readable. One Dark and
 * the satellite variant both start their labels with water names. Mapy has none to go under; its
 * labels are baked into the raster tiles.
 */
export function firstLabelLayerId(styleKey: MapStyleKey): string | undefined {
  switch (styleKey) {
    case 'onedark':
    case 'satellite':
      return 'water-label'
    case 'outdoors':
      return LIGHT_STYLE_FIRST_LABEL_LAYER_ID
    case 'mapy':
      return undefined
  }
}

/** The in-place changes a loaded base style takes as the mode and outdoor light change. */
export function styleLayerUpdates({
  styleKey,
  detailsVisible,
  imagery,
  roadLineOpacity,
}: {
  styleKey: MapStyleKey
  detailsVisible: boolean
  imagery: SatelliteImagery
  roadLineOpacity: number
}): StyleLayerUpdate[] {
  const layout = detailsLayout(detailsVisible)
  switch (styleKey) {
    case 'onedark':
      return [...DETAIL_LAYER_IDS].map((layerId) => ({ layerId, layout }))
    case 'outdoors':
      return LIGHT_STYLE_DETAIL_LAYER_IDS.map((layerId) => ({ layerId, layout }))
    case 'satellite':
      return [
        ...[...DETAIL_LAYER_IDS].map((layerId) => ({ layerId, layout })),
        {
          layerId: SATELLITE_IMAGERY_LAYER_ID,
          paint: {
            ...imageryPaint(imagery),
            'raster-opacity-transition': IMAGERY_TRANSITION,
            'raster-saturation-transition': IMAGERY_TRANSITION,
            'raster-contrast-transition': IMAGERY_TRANSITION,
          },
        },
        ...SATELLITE_ROAD_LINE_LAYER_IDS.map((layerId) => ({
          layerId,
          paint: { 'line-opacity': roadLineOpacity },
        })),
      ]
    case 'mapy':
      return []
  }
}

/** The Mapbox satellite raster plus street lines and labels from OpenMapTiles. */
export function buildSatelliteStyle({
  detailsVisible,
  tileUrl,
  imagery,
  roadLineOpacity,
  backgroundColor,
  roadColor,
}: {
  detailsVisible: boolean
  /** XYZ template, token included. */
  tileUrl: string
  imagery: SatelliteImagery
  roadLineOpacity: number
  backgroundColor: string
  roadColor: string
}) {
  // Paint comes from the Mapbox satellite document by layer id; source, filters, fonts and icon
  // names come from the One Dark port, the same translation it already does.
  const mapboxLayers = (
    JSON.parse(
      getSatelliteDarkMapStyle(
        true,
        true,
        false,
        true,
        roadLineOpacity,
        backgroundColor,
        roadColor,
      ),
    ) as { layers: StyleLayer[] }
  ).layers
  const ported = mapboxLayers.flatMap((mapbox): StyleLayer[] => {
    const omt = OPENMAPTILES_LAYERS.get(mapbox.id)
    if (!omt || omt.type !== mapbox.type || omt.type === 'background') return []
    const { layout: omtLayout = {} } = omt
    // Mapbox maki icon names do not exist in the OpenFreeMap sprite.
    const { 'icon-image': _makiIcon, ...mapboxLayout } = mapbox.layout ?? {}
    const layout = { ...mapboxLayout }
    for (const key of ['text-font', 'text-field', 'icon-image', 'symbol-placement']) {
      if (key in omtLayout) layout[key] = omtLayout[key]
    }
    return [
      withDetails(
        {
          ...omt,
          minzoom: mapbox.minzoom ?? omt.minzoom,
          layout,
          paint: mapbox.paint,
        },
        detailsVisible,
      ),
    ]
  })
  return {
    version: 8,
    name: 'Satellite (OpenMapTiles)',
    sources: {
      ...OPENMAPTILES_SOURCES,
      satellite: { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 22 },
    },
    ...STYLE_RESOURCES,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': backgroundColor } },
      {
        id: SATELLITE_IMAGERY_LAYER_ID,
        type: 'raster',
        source: 'satellite',
        paint: imageryPaint(imagery),
      },
      ...ported,
    ],
  }
}

/** Mapy.cz raster tiles over the blank backdrop. */
export function buildRasterStyle({ tileUrl, maxzoom }: { tileUrl: string; maxzoom: number }) {
  const blank = JSON.parse(BLANK_STYLE) as { layers: StyleLayer[] }
  return {
    version: 8,
    name: 'Raster',
    sources: { raster: { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom } },
    ...STYLE_RESOURCES,
    layers: [...blank.layers, { id: 'raster', type: 'raster', source: 'raster' }],
  }
}

/** OpenFreeMap's light style stands in for Mapbox Outdoors in the light theme. */
export const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** The plain base map for a theme, for maps that have no style picker of their own. */
export function mapStyleForAppTheme(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === 'dark'
    ? (buildOneDarkStyle({ detailsVisible: true }) as StyleSpecification)
    : LIGHT_STYLE_URL
}
