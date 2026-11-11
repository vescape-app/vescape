import type { EngineCamera } from '@/modules/map/lib/cameraEngine/engine'

import type { CameraEcho } from './benchmarkRecorder'

/**
 * Spike #642: the main map reports each camera write and camera-changed event here while the replay
 * benchmark runs. Null otherwise, so the main map pays one property read per frame.
 */
export const mainMapCameraProbe: {
  current: {
    write: (camera: EngineCamera, callMs: number) => void
    echo: (echo: CameraEcho) => void
  } | null
} = { current: null }
