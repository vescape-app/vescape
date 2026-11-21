import { RasterLayer, RasterSource } from '@rnmapbox/maps'
import { memo } from 'react'

import type { getSatelliteImageryPaint } from '@/modules/map/constants/satelliteDarkMapStyle'

const LAYER_TRANSITION = { duration: 260, delay: 0 } as const

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
