import { useCallback } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { LEGAL_LIMIT_MAP_CAMERA } from '@/modules/legal/lib/legalLimits'
import type { reduceMapCameraIntent } from '@/modules/map/lib/cameraController'
import { toEngineTarget } from '@/modules/map/lib/cameraEngine/cameraTarget'
import { getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import { getRouteFitCamera, type RouteCameraViewport } from '@/modules/map/lib/routeCamera'
import { clamp, MIN_ZOOM, type CameraSnapshot } from '@/modules/map/lib/cameraMotion'
import type { CameraControlRefs } from '@/screens/main/map/cameraControlTypes'

const PLACE_FOCUS_MIN_ZOOM = 15

interface UseCameraIntentCommandsParams {
  cameraRefs: CameraControlRefs
  gpsCamera: Pick<CameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
  mapOrientationMode: MapOrientationMode
  perspectiveEnabled: boolean
  /** Screen the route has to fit inside. */
  viewport: RouteCameraViewport
  dispatchCameraIntent: (
    intent: Parameters<typeof reduceMapCameraIntent>[1],
  ) => ReturnType<typeof reduceMapCameraIntent>['effect']
  getFollowHeadingDeg: () => number
  setFollowGps: (enabled: boolean) => void
  onHeadingChange: (heading: number) => void
  onPerspectiveChange: (enabled: boolean) => void
}

export function useCameraIntentCommands({
  cameraRefs,
  gpsCamera,
  mapOrientationMode,
  perspectiveEnabled,
  viewport,
  dispatchCameraIntent,
  getFollowHeadingDeg,
  setFollowGps,
  onHeadingChange,
  onPerspectiveChange,
}: UseCameraIntentCommandsParams) {
  const { currentCameraRef, engine, followZoomLevelRef } = cameraRefs
  const applyCamera = useCallback(
    (
      camera: Partial<CameraSnapshot> | undefined,
      overrides?: { zoomLevel?: number; immediate?: boolean },
    ) => {
      if (!camera) return
      const target = toEngineTarget({
        ...camera,
        zoomLevel: overrides?.zoomLevel ?? camera.zoomLevel,
      })
      if (overrides?.immediate) engine.snap(target)
      else engine.setTarget(target)
    },
    [engine],
  )

  const resetRotation = useCallback(() => {
    followZoomLevelRef.current = null
    applyCamera({ heading: 0 })
    onHeadingChange(0)
  }, [applyCamera, followZoomLevelRef, onHeadingChange])

  const togglePerspective = useCallback(() => {
    const enabled = !perspectiveEnabled
    onPerspectiveChange(enabled)
    const effect = dispatchCameraIntent({
      type: 'ChangePerspective',
      enabled,
      currentCamera: currentCameraRef.current,
      fallbackZoomLevel: gpsCamera.zoomLevel,
      orientationMode: mapOrientationMode,
    })
    applyCamera(effect?.camera)
  }, [
    applyCamera,
    currentCameraRef,
    dispatchCameraIntent,
    gpsCamera.zoomLevel,
    mapOrientationMode,
    onPerspectiveChange,
    perspectiveEnabled,
  ])

  const setPadding = useCallback(
    (bottom: number) => {
      const padding = { paddingBottom: bottom, paddingTop: 0, paddingLeft: 0, paddingRight: 0 }
      // Removing the padding (entering map mode) is intentionally instant.
      if (bottom === 0) {
        engine.snap({ padding })
      } else {
        engine.setTarget({ padding })
      }
    },
    [engine],
  )

  const zoomBy = useCallback(
    (delta: number) => {
      setFollowGps(false)
      const zoomLevel = clamp(
        (currentCameraRef.current?.zoomLevel ?? gpsCamera.zoomLevel) + delta,
        MIN_ZOOM,
        MAP_DEFAULTS.maxZoom,
      )
      const current = currentCameraRef.current
      applyCamera({
        ...(current ? { centerCoordinate: current.centerCoordinate } : {}),
        zoomLevel,
        pitch: getPitchForZoom(zoomLevel, perspectiveEnabled),
      })
    },
    [applyCamera, currentCameraRef, gpsCamera.zoomLevel, perspectiveEnabled, setFollowGps],
  )

  const focusCoordinate = useCallback(
    (coordinate: [number, number], immediate = false) => {
      setFollowGps(false)
      const effect = dispatchCameraIntent({
        type: 'FocusCoordinate',
        coordinate,
        currentCamera: currentCameraRef.current,
        fallbackZoomLevel: Math.max(gpsCamera.zoomLevel, PLACE_FOCUS_MIN_ZOOM),
        orientationMode: mapOrientationMode,
        perspectiveEnabled,
      })
      applyCamera(effect?.camera, {
        zoomLevel: Math.max(
          effect?.camera.zoomLevel ?? currentCameraRef.current?.zoomLevel ?? PLACE_FOCUS_MIN_ZOOM,
          PLACE_FOCUS_MIN_ZOOM,
        ),
        immediate,
      })
    },
    [
      applyCamera,
      currentCameraRef,
      dispatchCameraIntent,
      gpsCamera.zoomLevel,
      mapOrientationMode,
      perspectiveEnabled,
      setFollowGps,
    ],
  )

  const centerCoordinatePreservingCamera = useCallback(
    (coordinate: [number, number]) => {
      setFollowGps(false)
      const current = currentCameraRef.current
      const camera = {
        centerCoordinate: coordinate,
        zoomLevel: current?.zoomLevel ?? gpsCamera.zoomLevel,
        heading: current?.heading ?? getFollowHeadingDeg(),
        pitch: current?.pitch ?? getPitchForZoom(gpsCamera.zoomLevel, perspectiveEnabled),
        padding: { paddingBottom: 0, paddingTop: 0, paddingLeft: 0, paddingRight: 0 },
      }
      currentCameraRef.current = camera
      applyCamera(camera)
    },
    [
      applyCamera,
      currentCameraRef,
      getFollowHeadingDeg,
      gpsCamera.zoomLevel,
      perspectiveEnabled,
      setFollowGps,
    ],
  )

  /**
   * Pull the camera back until a whole path fits. Used when a Navigation is drawn and the rider is
   * deciding whether to ride it: judging a route needs both ends on screen, not a close follow view.
   */
  const fitRoute = useCallback(
    (route: [number, number][]) => {
      const camera = getRouteFitCamera({ route, viewport, maxZoom: MAP_DEFAULTS.maxZoom })
      if (!camera) return
      setFollowGps(false)
      const effect = dispatchCameraIntent({
        type: 'FitRoute',
        camera: {
          ...camera,
          heading: 0,
          pitch: getPitchForZoom(camera.zoomLevel, perspectiveEnabled),
        },
      })
      applyCamera(effect?.camera)
      onHeadingChange(0)
    },
    [
      applyCamera,
      dispatchCameraIntent,
      onHeadingChange,
      perspectiveEnabled,
      setFollowGps,
      viewport,
    ],
  )

  const focusWeather = useCallback(() => {
    const effect = dispatchCameraIntent({
      type: 'EnterWeatherView',
      currentCamera: currentCameraRef.current,
      fallbackCenterCoordinate: gpsCamera.centerCoordinate,
      perspectiveEnabled,
    })
    applyCamera(effect?.camera)
  }, [
    applyCamera,
    currentCameraRef,
    dispatchCameraIntent,
    gpsCamera.centerCoordinate,
    perspectiveEnabled,
  ])

  const focusLegalLimits = useCallback(() => {
    const effect = dispatchCameraIntent({
      type: 'EnterLegalLimitsView',
      camera: LEGAL_LIMIT_MAP_CAMERA,
    })
    applyCamera(effect?.camera)
  }, [applyCamera, dispatchCameraIntent])

  return {
    resetRotation,
    togglePerspective,
    setPadding,
    zoomBy,
    focusCoordinate,
    fitRoute,
    centerCoordinatePreservingCamera,
    focusWeather,
    focusLegalLimits,
  }
}
