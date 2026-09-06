import type { Camera as CameraRef } from '@rnmapbox/maps'
import type { ForwardedRef, RefObject } from 'react'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'
import type { MapCameraControllerState } from '@/modules/map/lib/cameraController'
import type { RouteCameraViewport } from '@/modules/map/lib/routeCamera'
import type { CameraSnapshot, HistoryPreviewTarget } from '@/modules/map/lib/cameraMotion'
import type { MainMapHandle } from '@/screens/main/map/MainMap'

export interface GpsFix {
  latitude: number
  longitude: number
  timestamp: number
  accuracyM?: number | null
}

export interface CameraControlRefs {
  cameraRef: RefObject<CameraRef | null>
  currentCameraRef: RefObject<CameraSnapshot | null>
  controllerStateRef: RefObject<MapCameraControllerState>
  followZoomLevelRef: RefObject<number | null>
  lastFollowKeyRef: RefObject<string | null>
  /** True while the reveal gesture drives the camera itself; map echoes are ignored then. */
  previewPanActiveRef: RefObject<boolean>
  engine: CameraEngine
}

export interface UseCameraControlsParams {
  ref: ForwardedRef<MainMapHandle>
  cameraFix: GpsFix | null
  persistedFallback: [number, number] | null
  perspectiveEnabled: boolean
  mapViewport: RouteCameraViewport
  mapOrientationMode: MapOrientationMode
  heading: {
    phoneReady: boolean
    getFollowDeg: () => number
    resetOnRecenter: boolean
  }
  history: {
    active: boolean
    selectionKey: string | null
    preview: ({ key: string } & HistoryPreviewTarget) | null
    previewRoute: [number, number][]
    rideRoute: [number, number][]
    /** The stretch of the ride the telemetry chart is zoomed into; empty when it shows it all. */
    focusRoute: [number, number][]
  }
  follow: {
    updatesEnabled: boolean
  }
  getViewfinderCoordinateFromMap?: () => Promise<{ latitude: number; longitude: number } | null>
  onHeadingChange: (heading: number) => void
  onPerspectiveChange: (enabled: boolean) => void
}
