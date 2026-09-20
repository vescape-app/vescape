import Mapbox, { SymbolLayer } from '@rnmapbox/maps'
import { memo } from 'react'

import type { MapStyleKey } from '@/modules/map/constants/mapStyles'

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

/**
 * Overrides for layers the loaded base style already owns. Only mounted once the
 * matching style signature has finished loading, otherwise the ids do not exist yet.
 */
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
              iconColor: '#8ba4bf',
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
              iconColor: '#8ba4bf',
              iconHaloWidth: 0,
              iconOpacity: 0.76,
            }}
          />
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
      </>
    )
  }

  return null
})
