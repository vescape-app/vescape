import Mapbox, { SymbolLayer } from '@rnmapbox/maps'
import { memo } from 'react'

import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import { CUSTOM_DISTRICT_LABEL_LAYER_IDS } from '@/modules/map/constants/oneDarkMapStyle'
import { ONE_DARK_POI_ICON_COLOR } from '@/modules/map/constants/oneDarkOverlayLayers'
import { MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS } from '@/screens/main/map/baseStyleLayerIds'

const SATELLITE_ROAD_LINE_LAYER_IDS = [
  'road-path',
  'road-track',
  'road-service',
  'road-street',
  'road-secondary-tertiary',
  'road-primary',
  'road-trunk',
  'road-motorway',
] as const

const LAYER_TRANSITION = { duration: 260, delay: 0 } as const

export const MapBaseStyleLayers = memo(function MapBaseStyleLayers({
  enabled,
  existingLayerIds,
  styleKey,
  isOneDark,
  isSatellite,
  isSatelliteOverlay,
  mapDetailsVisible,
  satelliteRoadLineOpacity,
}: {
  enabled: boolean
  existingLayerIds: ReadonlySet<string>
  styleKey: MapStyleKey
  isOneDark: boolean
  isSatellite: boolean
  isSatelliteOverlay: boolean
  mapDetailsVisible: boolean
  satelliteRoadLineOpacity: number
}) {
  if (!enabled) return null
  const visibility = mapDetailsVisible ? 'visible' : 'none'

  if (isSatelliteOverlay) {
    return (
      <>
        {SATELLITE_ROAD_LINE_LAYER_IDS.map(
          (id) =>
            existingLayerIds.has(id) && (
              <Mapbox.LineLayer
                key={id}
                id={id}
                existing
                style={{
                  lineOpacity: satelliteRoadLineOpacity,
                  lineOpacityTransition: LAYER_TRANSITION,
                }}
              />
            ),
        )}
        {existingLayerIds.has('poi-label') && (
          <SymbolLayer id="poi-label" existing style={{ visibility }} />
        )}
        {existingLayerIds.has('transit-label') && (
          <SymbolLayer id="transit-label" existing style={{ visibility }} />
        )}
        {CUSTOM_DISTRICT_LABEL_LAYER_IDS.map(
          (id) =>
            existingLayerIds.has(id) && (
              <SymbolLayer key={id} id={id} existing style={{ visibility }} />
            ),
        )}
      </>
    )
  }

  if (isOneDark) {
    return (
      <>
        {existingLayerIds.has('poi-label') && (
          <SymbolLayer
            id="poi-label"
            existing
            style={{
              visibility,
              iconColor: ONE_DARK_POI_ICON_COLOR,
              iconHaloWidth: 0,
              iconOpacity: 0.76,
            }}
          />
        )}
        {existingLayerIds.has('transit-label') && (
          <SymbolLayer
            id="transit-label"
            existing
            style={{
              visibility,
              iconColor: ONE_DARK_POI_ICON_COLOR,
              iconHaloWidth: 0,
              iconOpacity: 0.76,
            }}
          />
        )}
        {CUSTOM_DISTRICT_LABEL_LAYER_IDS.map(
          (id) =>
            existingLayerIds.has(id) && (
              <SymbolLayer key={id} id={id} existing style={{ visibility }} />
            ),
        )}
      </>
    )
  }

  if (styleKey === 'outdoors' || isSatellite) {
    return (
      <>
        {existingLayerIds.has('poi-label') && (
          <SymbolLayer id="poi-label" existing style={{ visibility }} />
        )}
        {existingLayerIds.has('transit-label') && (
          <SymbolLayer id="transit-label" existing style={{ visibility }} />
        )}
        {MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS.map(
          (id) =>
            existingLayerIds.has(id) && (
              <SymbolLayer key={id} id={id} existing style={{ visibility }} />
            ),
        )}
      </>
    )
  }

  return null
})
