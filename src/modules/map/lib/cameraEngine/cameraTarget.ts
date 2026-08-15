import type { CameraEngineTarget } from '@/modules/map/lib/cameraEngine/engine'
import type { CameraSnapshot } from '@/modules/map/lib/cameraMotion'

/**
 * Camera snapshots carry every axis; engine targets carry only the axes a caller
 * wants to move. Undefined axes are dropped so the springs keep their current
 * target instead of being retargeted at `undefined`.
 */
export function toEngineTarget(camera: Partial<CameraSnapshot>): CameraEngineTarget {
  return {
    ...(camera.centerCoordinate ? { center: camera.centerCoordinate } : {}),
    ...(camera.zoomLevel != null ? { zoom: camera.zoomLevel } : {}),
    ...(camera.heading != null ? { heading: camera.heading } : {}),
    ...(camera.pitch != null ? { pitch: camera.pitch } : {}),
    ...(camera.padding ? { padding: camera.padding } : {}),
  }
}
