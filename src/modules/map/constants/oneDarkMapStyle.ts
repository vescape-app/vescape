import { ONE_DARK_BASE_LAYERS } from '@/modules/map/constants/oneDarkBaseLayers'
import { ONE_DARK_OVERLAY_LAYERS } from '@/modules/map/constants/oneDarkOverlayLayers'

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
  layers: [...ONE_DARK_BASE_LAYERS, ...ONE_DARK_OVERLAY_LAYERS],
})

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
