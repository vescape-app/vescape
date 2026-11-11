import type { CameraRef } from '@maplibre/maplibre-react-native'

import type { EnginePadding } from '@/modules/map/lib/cameraEngine/engine'

type DirectCameraOptions = Parameters<CameraRef['setCameraDirect']>[0]

/** The app's camera shape as the MapLibre direct write takes it: heading → bearing, padding sides. */
export function toDirectCamera(camera: {
  center?: [number, number]
  zoom?: number
  heading?: number
  pitch?: number
  padding?: EnginePadding
}): DirectCameraOptions {
  const { center, zoom, heading, pitch, padding } = camera
  return {
    center,
    zoom,
    bearing: heading,
    pitch,
    padding: padding && {
      top: padding.paddingTop,
      right: padding.paddingRight,
      bottom: padding.paddingBottom,
      left: padding.paddingLeft,
    },
  }
}
