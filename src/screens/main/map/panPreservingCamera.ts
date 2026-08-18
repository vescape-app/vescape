import type { RefObject } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { toEngineTarget } from '@/modules/map/lib/cameraEngine/cameraTarget'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'

import type { CameraSnapshot } from '@/screens/main/map/useCameraControls'

/**
 * Move the camera to a coordinate while keeping the current zoom, heading and pitch.
 * Shared by every "focus this point" flow so they stay visually identical.
 */
export function panPreservingCamera(
  engine: CameraEngine,
  currentCameraRef: RefObject<CameraSnapshot | null>,
  centerCoordinate: [number, number],
  options?: { minZoomLevel?: number },
) {
  const current = currentCameraRef.current
  const zoomLevel =
    options?.minZoomLevel == null
      ? current?.zoomLevel
      : Math.max(current?.zoomLevel ?? MAP_DEFAULTS.persistedGpsFallbackZoom, options.minZoomLevel)
  engine.setTarget(
    toEngineTarget({
      centerCoordinate,
      zoomLevel,
      heading: current?.heading,
      pitch: current?.pitch,
    }),
  )
}
