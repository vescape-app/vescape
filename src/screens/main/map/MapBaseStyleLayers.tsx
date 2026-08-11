import Mapbox, { RasterLayer, SymbolLayer } from '@rnmapbox/maps'
import { memo } from 'react'

import type { getSatelliteImageryPaint } from '@/modules/map/constants/satelliteDarkMapStyle'
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
  styleKey,
  isOneDark,
  isSatellite,
  isSatelliteOverlay,
  mapDetailsVisible,
  satelliteImageryPaint,
  satelliteRoadLineOpacity,
}: {
  enabled: boolean
  styleKey: MapStyleKey
  isOneDark: boolean
  isSatellite: boolean
  isSatelliteOverlay: boolean
  mapDetailsVisible: boolean
  satelliteImageryPaint: ReturnType<typeof getSatelliteImageryPaint>
  satelliteRoadLineOpacity: number
}) {
  if (!enabled) return null
  const visibility = mapDetailsVisible ? 'visible' : 'none'

  if (isSatelliteOverlay) {
    return (
      <>
        <RasterLayer
          id="satellite"
          existing
          style={{
            ...satelliteImageryPaint,
            rasterOpacityTransition: LAYER_TRANSITION,
            rasterSaturationTransition: LAYER_TRANSITION,
            rasterContrastTransition: LAYER_TRANSITION,
          }}
        />
        {SATELLITE_ROAD_LINE_LAYER_IDS.map((id) => (
          <Mapbox.LineLayer
            key={id}
            id={id}
            existing
            style={{
              lineOpacity: satelliteRoadLineOpacity,
              lineOpacityTransition: LAYER_TRANSITION,
            }}
          />
        ))}
        <SymbolLayer id="poi-label" existing style={{ visibility }} />
        <SymbolLayer id="transit-label" existing style={{ visibility }} />
      </>
    )
  }

  if (isOneDark) {
    return (
      <>
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
      </>
    )
  }

  if (styleKey === 'outdoors' || isSatellite) {
    return (
      <>
        <SymbolLayer id="poi-label" existing style={{ visibility }} />
        <SymbolLayer id="transit-label" existing style={{ visibility }} />
      </>
    )
  }

  return null
})
