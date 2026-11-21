import type { CameraEngineTarget } from '@/modules/map/lib/cameraEngine/engine'
import type { CameraSnapshot } from '@/modules/map/lib/cameraMotion'

export function toEngineTarget(camera: Partial<CameraSnapshot>): CameraEngineTarget {
  return {
    ...(camera.centerCoordinate ? { center: camera.centerCoordinate } : {}),
    ...(camera.zoomLevel != null ? { zoom: camera.zoomLevel } : {}),
    ...(camera.heading != null ? { heading: camera.heading } : {}),
    ...(camera.pitch != null ? { pitch: camera.pitch } : {}),
    ...(camera.padding ? { padding: camera.padding } : {}),
  }
}
