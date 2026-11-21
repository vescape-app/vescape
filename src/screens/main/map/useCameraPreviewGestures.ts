import { useCallback, useLayoutEffect, useRef } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import {
  type CameraPadding,
  getMapRevealPitch,
  getPitchForZoom,
} from '@/modules/map/lib/cameraProfiles'
import { getCameraAfterScreenDrag } from '@/modules/map/lib/cameraPanProjection'
import type { reduceMapCameraIntent } from '@/modules/map/lib/cameraController'
import {
  clamp,
  liveFollowKey,
  MAP_REVEAL_ZOOM_OUT_DELTA,
  MIN_ZOOM,
  type CameraSnapshot,
} from '@/modules/map/lib/cameraMotion'
import type { CameraControlRefs, GpsFix } from '@/screens/main/map/cameraControlTypes'

interface UseCameraPreviewGesturesParams {
  cameraRefs: CameraControlRefs
  cameraFix: GpsFix | null
  gpsCamera: Pick<CameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
  perspectiveEnabled: boolean
  applyLiveFollowCamera: () => void
  dispatchCameraIntent: (
    intent: Parameters<typeof reduceMapCameraIntent>[1],
  ) => ReturnType<typeof reduceMapCameraIntent>['effect']
  getFollowHeadingDeg: () => number
  getFollowFrameForZoom: (zoom: number) => { pitch: number; padding: CameraPadding }
  getLiveFollowCamera: () => CameraSnapshot
  setFollowZoomLevel: (zoomLevel: number) => void
}

export function useCameraPreviewGestures({
  cameraRefs,
  cameraFix,
  gpsCamera,
  perspectiveEnabled,
  applyLiveFollowCamera,
  dispatchCameraIntent,
  getFollowHeadingDeg,
  getFollowFrameForZoom,
  getLiveFollowCamera,
  setFollowZoomLevel,
}: UseCameraPreviewGesturesParams) {
  const {
    cameraRef,
    controllerStateRef,
    currentCameraRef,
    engine,
    lastFollowKeyRef,
    previewPanActiveRef,
  } = cameraRefs
  const ownsCamera = useCallback(
    () => controllerStateRef.current.mode.kind === 'previewPan',
    [controllerStateRef],
  )
  const followingLive = useCallback(
    () =>
      controllerStateRef.current.mode.kind === 'liveFollow' &&
      imperativeHandleLatestRef.current.cameraFix != null,
    [controllerStateRef],
  )
  const previewPanBaseRef = useRef<CameraSnapshot | null>(null)
  const previewZoomBaseRef = useRef<CameraSnapshot | null>(null)
  const previewZoomedRef = useRef(false)
  const imperativeHandleLatest = {
    applyLiveFollowCamera,
    cameraFix,
    getFollowHeadingDeg,
    getFollowFrameForZoom,
    getLiveFollowCamera,
    gpsCamera,
    perspectiveEnabled,
    setFollowZoomLevel,
  }
  const imperativeHandleLatestRef = useRef(imperativeHandleLatest)
  useLayoutEffect(() => {
    imperativeHandleLatestRef.current = imperativeHandleLatest
  })

  const beginPreviewPan = useCallback(() => {
    const latest = imperativeHandleLatestRef.current
    previewPanActiveRef.current = true
    previewPanBaseRef.current = currentCameraRef.current ?? {
      ...latest.gpsCamera,
      heading: latest.getFollowHeadingDeg(),
      pitch: getPitchForZoom(latest.gpsCamera.zoomLevel, latest.perspectiveEnabled),
    }
    dispatchCameraIntent({ type: 'BeginPreviewPan' })
  }, [currentCameraRef, dispatchCameraIntent, previewPanActiveRef])

  const previewPanBy = useCallback(
    (deltaX: number, deltaY: number, revealProgress: number) => {
      const latest = imperativeHandleLatestRef.current
      const baseCamera = previewPanBaseRef.current
      if (!baseCamera || !ownsCamera()) return
      const zoomLevel = clamp(
        baseCamera.zoomLevel - MAP_REVEAL_ZOOM_OUT_DELTA * revealProgress,
        MIN_ZOOM,
        MAP_DEFAULTS.maxZoom,
      )
      const previewCamera = {
        ...getCameraAfterScreenDrag({ ...baseCamera, zoomLevel }, deltaX, deltaY),
        zoomLevel,
        pitch: getMapRevealPitch({
          basePitch: baseCamera.pitch,
          zoom: zoomLevel,
          revealProgress,
          perspectiveEnabled: latest.perspectiveEnabled,
        }),
      }
      currentCameraRef.current = previewCamera
      engine.driveExternal(
        {
          centerCoordinate: previewCamera.centerCoordinate,
          zoomLevel: previewCamera.zoomLevel,
          heading: previewCamera.heading,
          pitch: previewCamera.pitch,
        },
        { gesture: true },
      )
      cameraRef.current?.setCameraDirect({
        center: previewCamera.centerCoordinate,
        zoom: previewCamera.zoomLevel,
        heading: previewCamera.heading,
        pitch: previewCamera.pitch,
      })
    },
    [cameraRef, currentCameraRef, engine, ownsCamera],
  )

  const endPreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    previewPanBaseRef.current = null
    const owned = ownsCamera()
    dispatchCameraIntent({ type: 'EndPreviewPan' })
    if (!owned) return
    engine.release()
    const current = currentCameraRef.current
    if (current) {
      engine.setTarget({
        pitch: getPitchForZoom(
          current.zoomLevel,
          imperativeHandleLatestRef.current.perspectiveEnabled,
        ),
      })
    }
  }, [currentCameraRef, dispatchCameraIntent, engine, ownsCamera, previewPanActiveRef])

  const beginPreviewZoom = useCallback(() => {
    const latest = imperativeHandleLatestRef.current
    previewZoomedRef.current = false
    previewZoomBaseRef.current = followingLive()
      ? latest.getLiveFollowCamera()
      : currentCameraRef.current
  }, [currentCameraRef, followingLive])

  const previewZoomBy = useCallback(
    (scale: number) => {
      const latest = imperativeHandleLatestRef.current
      const baseCamera = previewZoomBaseRef.current
      if (!baseCamera || scale <= 0) return
      const zoomLevel = clamp(
        baseCamera.zoomLevel + Math.log2(scale),
        MIN_ZOOM,
        MAP_DEFAULTS.maxZoom,
      )
      previewZoomedRef.current = true
      latest.setFollowZoomLevel(zoomLevel)
      const live = followingLive()
      const followCamera = live ? latest.getLiveFollowCamera() : baseCamera
      const previewCamera = {
        ...followCamera,
        zoomLevel,
        ...(live
          ? latest.getFollowFrameForZoom(zoomLevel)
          : { pitch: getPitchForZoom(zoomLevel, latest.perspectiveEnabled) }),
      }
      currentCameraRef.current = previewCamera
      if (cameraFix) {
        lastFollowKeyRef.current = liveFollowKey(cameraFix.timestamp, previewCamera)
      }
      engine.driveExternal(
        {
          centerCoordinate: previewCamera.centerCoordinate,
          zoomLevel: previewCamera.zoomLevel,
          heading: previewCamera.heading,
          pitch: previewCamera.pitch,
          padding: previewCamera.padding,
        },
        { gesture: true },
      )
      cameraRef.current?.setCameraDirect({
        center: previewCamera.centerCoordinate,
        zoom: previewCamera.zoomLevel,
        heading: previewCamera.heading,
        pitch: previewCamera.pitch,
        padding: previewCamera.padding,
      })
    },
    [cameraFix, cameraRef, currentCameraRef, engine, followingLive, lastFollowKeyRef],
  )

  const endPreviewZoom = useCallback(() => {
    previewZoomBaseRef.current = null
    if (!previewZoomedRef.current) return
    previewZoomedRef.current = false
    const latest = imperativeHandleLatestRef.current
    engine.release()
    const live = followingLive()
    const current = currentCameraRef.current
    if (current) {
      engine.setTarget({
        zoom: current.zoomLevel,
        pitch: live
          ? latest.getFollowFrameForZoom(current.zoomLevel).pitch
          : getPitchForZoom(current.zoomLevel, latest.perspectiveEnabled),
      })
    }
    if (live) latest.applyLiveFollowCamera()
  }, [currentCameraRef, engine, followingLive])

  const restorePreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    const anchorCamera = previewPanBaseRef.current
    previewPanBaseRef.current = null
    const effect = dispatchCameraIntent({
      type: 'CancelPreviewPan',
      liveCamera: cameraFix ? getLiveFollowCamera() : null,
      anchorCamera: anchorCamera ?? currentCameraRef.current,
    })
    const restoreCamera = effect?.camera
    if (!restoreCamera) return
    if (cameraFix && restoreCamera.zoomLevel != null && restoreCamera.heading != null) {
      lastFollowKeyRef.current = liveFollowKey(cameraFix.timestamp, {
        zoomLevel: restoreCamera.zoomLevel,
        heading: restoreCamera.heading,
      })
    }
    engine.setTarget({
      center: restoreCamera.centerCoordinate,
      zoom: restoreCamera.zoomLevel,
      heading: restoreCamera.heading,
      pitch: restoreCamera.pitch,
      padding: restoreCamera.padding,
    })
  }, [
    cameraFix,
    currentCameraRef,
    dispatchCameraIntent,
    engine,
    getLiveFollowCamera,
    lastFollowKeyRef,
    previewPanActiveRef,
  ])

  return {
    previewPanActiveRef,
    beginPreviewPan,
    previewPanBy,
    endPreviewPan,
    beginPreviewZoom,
    previewZoomBy,
    endPreviewZoom,
    restorePreviewPan,
  }
}
