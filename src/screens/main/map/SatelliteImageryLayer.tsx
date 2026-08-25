import { RasterLayer, RasterSource } from '@rnmapbox/maps'
import { memo } from 'react'

import type { getSatelliteImageryPaint } from '@/modules/map/constants/satelliteDarkMapStyle'

const LAYER_TRANSITION = { duration: 260, delay: 0 } as const

/**
 * Satellite imagery for the satellite-overlay style.
 *
 * The layer is owned rather than adopted from the style JSON with `existing`: on iOS Release builds
 * an adopted raster layer never receives its paint updates, so the map stayed stuck at the telemetry
 * dimming (#423). Owning the source and layer routes paint through the same path the Mapy tiles use,
 * which works on both platforms.
 *
 * Inserted below `road-path` so the style's street lines and labels stay on top of the imagery.
 */
export const SatelliteImageryLayer = memo(function SatelliteImageryLayer({
  paint,
}: {
  paint: ReturnType<typeof getSatelliteImageryPaint>
}) {
  return (
    <RasterSource id="center-satellite" url="mapbox://mapbox.satellite" tileSize={256}>
      <RasterLayer
        id="center-satellite-layer"
        sourceID="center-satellite"
        belowLayerID="road-path"
        style={{
          ...paint,
          rasterOpacityTransition: LAYER_TRANSITION,
          rasterSaturationTransition: LAYER_TRANSITION,
          rasterContrastTransition: LAYER_TRANSITION,
        }}
      />
    </RasterSource>
  )
})
