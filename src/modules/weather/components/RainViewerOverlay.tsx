import { RasterLayer, RasterSource } from '@rnmapbox/maps'
import { useEffect } from 'react'

import {
  buildRainViewerTileTemplate,
  useRainViewerRadarStore,
} from '@/modules/weather/store/rainViewerRadarStore'

const RADAR_OPACITY = 0.55
const AUTO_RADAR_FRAME_FADE_MS = 450
const MANUAL_RADAR_FRAME_FADE_MS = 180

interface RainViewerOverlayProps {
  visible: boolean
}

export function RainViewerOverlay({ visible }: RainViewerOverlayProps) {
  const host = useRainViewerRadarStore((state) => state.host)
  const frames = useRainViewerRadarStore((state) => state.frames)
  const selectedFrameIndex = useRainViewerRadarStore((state) => state.selectedFrameIndex)
  const transitionMode = useRainViewerRadarStore((state) => state.transitionMode)
  const fetchRadar = useRainViewerRadarStore((state) => state.fetch)

  useEffect(() => {
    if (!visible) return undefined

    fetchRadar()
    const interval = setInterval(() => void fetchRadar(true), 5 * 60 * 1_000)
    return () => {
      clearInterval(interval)
    }
  }, [fetchRadar, visible])

  if (!host || frames.length === 0 || !visible) return null

  const fadeMs = transitionMode === 'auto' ? AUTO_RADAR_FRAME_FADE_MS : MANUAL_RADAR_FRAME_FADE_MS

  return (
    <>
      {frames.map((frame, index) => {
        const sourceId = `center-rainviewer-radar-${frame.time}`
        const layerId = `center-rainviewer-radar-layer-${frame.time}`
        const tileTemplate = buildRainViewerTileTemplate(host, frame)

        return (
          <RasterSource
            key={sourceId}
            id={sourceId}
            tileUrlTemplates={[tileTemplate]}
            tileSize={512}
            maxZoomLevel={6}
          >
            <RasterLayer
              id={layerId}
              sourceID={sourceId}
              style={{
                rasterOpacity: index === selectedFrameIndex ? RADAR_OPACITY : 0,
                rasterOpacityTransition: { duration: fadeMs, delay: 0 },
                rasterFadeDuration: fadeMs,
              }}
            />
          </RasterSource>
        )
      })}
    </>
  )
}
