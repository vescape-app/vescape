import { useCallback, useEffect } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { reduceMapCameraIntent } from '@/modules/map/lib/cameraController'
import { toEngineTarget } from '@/modules/map/lib/cameraEngine/cameraTarget'
import { getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import { getRouteFitCamera, type RouteCameraViewport } from '@/modules/map/lib/routeCamera'
import {
  getHistoryPreviewBounds,
  getHistoryPreviewZoom,
  type HistoryPreviewTarget,
} from '@/modules/map/lib/cameraMotion'
import type { CameraControlRefs } from '@/screens/main/map/cameraControlTypes'

interface UseHistoryCameraFramingParams {
  cameraRefs: CameraControlRefs
  active: boolean
  selectionKey: string | null
  preview: ({ key: string } & HistoryPreviewTarget) | null
  previewRoute: [number, number][]
  rideRoute: [number, number][]
  viewport: RouteCameraViewport
  perspectiveEnabled: boolean
  dispatchCameraIntent: (
    intent: Parameters<typeof reduceMapCameraIntent>[1],
  ) => ReturnType<typeof reduceMapCameraIntent>['effect']
  setCameraModeRef: (mode: {
    kind: 'rideHistory'
    selectionKey: string | null
    phase: 'preview'
  }) => void
  onHeadingChange: (heading: number) => void
}

export function useHistoryCameraFraming({
  cameraRefs,
  active,
  selectionKey,
  preview,
  previewRoute,
  rideRoute,
  viewport,
  perspectiveEnabled,
  dispatchCameraIntent,
  setCameraModeRef,
  onHeadingChange,
}: UseHistoryCameraFramingParams) {
  const { controllerStateRef, engine } = cameraRefs
  const getHistoryPreviewCamera = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      const camera = getRouteFitCamera({
        route: [[coordinate.longitude, coordinate.latitude]],
        viewport,
        maxZoom: MAP_DEFAULTS.maxZoom,
      })
      const zoomLevel = getHistoryPreviewZoom(
        camera?.zoomLevel ?? MAP_DEFAULTS.persistedGpsFallbackZoom,
      )
      return {
        centerCoordinate:
          camera?.centerCoordinate ??
          ([coordinate.longitude, coordinate.latitude] as [number, number]),
        zoomLevel,
        heading: 0,
        pitch: getPitchForZoom(zoomLevel, perspectiveEnabled),
        padding: camera?.padding,
      }
    },
    [perspectiveEnabled, viewport],
  )

  const fitRide = useCallback(
    (nextSelectionKey: string | null) => {
      const historyCamera = getRouteFitCamera({
        route: rideRoute,
        viewport,
        maxZoom: MAP_DEFAULTS.maxZoom,
      })
      if (!historyCamera) return
      const effect = dispatchCameraIntent({
        type: 'RefineRideHistoryRoute',
        selectionKey: nextSelectionKey,
        camera: {
          ...historyCamera,
          heading: 0,
          pitch: getPitchForZoom(historyCamera.zoomLevel, perspectiveEnabled),
        },
      })
      if (!effect) return
      engine.setTarget(toEngineTarget(effect.camera))
      onHeadingChange(0)
    },
    [dispatchCameraIntent, engine, onHeadingChange, perspectiveEnabled, rideRoute, viewport],
  )

  const previewHistorySession = useCallback(
    (nextPreview: HistoryPreviewTarget & { key?: string }) => {
      const bounds = getHistoryPreviewBounds(nextPreview)
      if (bounds) {
        const historyCamera = getRouteFitCamera({
          route: [bounds.ne, bounds.sw],
          viewport,
          maxZoom: MAP_DEFAULTS.maxZoom,
        })
        if (historyCamera) {
          const zoomLevel = getHistoryPreviewZoom(historyCamera.zoomLevel)
          const effect = dispatchCameraIntent({
            type: 'FrameRideHistoryPreview',
            selectionKey: nextPreview.key ?? null,
            camera: {
              ...historyCamera,
              zoomLevel,
              heading: 0,
              pitch: getPitchForZoom(zoomLevel, perspectiveEnabled),
            },
          })
          if (!effect) return
          engine.setTarget(toEngineTarget(effect.camera))
        }
      } else {
        const previewCamera = getHistoryPreviewCamera(nextPreview)
        const effect = dispatchCameraIntent({
          type: 'FrameRideHistoryPreview',
          selectionKey: nextPreview.key ?? null,
          camera: previewCamera,
        })
        if (!effect) return
        engine.setTarget(toEngineTarget(effect.camera))
      }
      onHeadingChange(0)
    },
    [
      dispatchCameraIntent,
      engine,
      getHistoryPreviewCamera,
      onHeadingChange,
      perspectiveEnabled,
      viewport,
    ],
  )

  const previewHistoryRoute = useCallback(
    (nextSelectionKey: string, route: [number, number][]) => {
      const historyCamera = getRouteFitCamera({
        route,
        viewport,
        maxZoom: MAP_DEFAULTS.maxZoom,
      })
      if (!historyCamera) return
      const effect = dispatchCameraIntent({
        type: 'FrameRideHistoryPreview',
        selectionKey: nextSelectionKey,
        camera: {
          ...historyCamera,
          heading: 0,
          pitch: getPitchForZoom(historyCamera.zoomLevel, perspectiveEnabled),
        },
      })
      if (!effect) return
      engine.setTarget(toEngineTarget(effect.camera))
      onHeadingChange(0)
    },
    [dispatchCameraIntent, engine, onHeadingChange, perspectiveEnabled, viewport],
  )

  useEffect(() => {
    if (!active || !selectionKey) return

    const mode = controllerStateRef.current.mode
    if (mode.kind !== 'rideHistory' || mode.selectionKey !== selectionKey) {
      setCameraModeRef({
        kind: 'rideHistory',
        selectionKey,
        phase: 'preview',
      })
    }

    const frame = requestAnimationFrame(() => {
      if (rideRoute.length > 0) {
        fitRide(selectionKey)
        return
      }
      if (previewRoute.length > 0) {
        previewHistoryRoute(selectionKey, previewRoute)
        return
      }
      if (preview?.key === selectionKey) {
        previewHistorySession(preview)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [
    active,
    controllerStateRef,
    fitRide,
    preview,
    previewHistoryRoute,
    previewHistorySession,
    previewRoute,
    rideRoute,
    selectionKey,
    setCameraModeRef,
  ])

  return {
    getHistoryPreviewCamera,
    previewHistorySession,
  }
}
