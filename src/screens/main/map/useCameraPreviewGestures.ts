import { useCallback, useLayoutEffect, useRef } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { getMapRevealPitch, getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import { getCameraAfterScreenDrag } from '@/modules/map/lib/cameraPanProjection'
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
  followGps: boolean
  gpsCamera: Pick<CameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
  historyActive: boolean
  perspectiveEnabled: boolean
  applyLiveFollowCamera: () => void
  enterCameraMode: (mode: { kind: 'liveFollow' }) => void
  getFollowHeadingDeg: () => number
  getLiveFollowCamera: () => CameraSnapshot
  setFollowGps: (enabled: boolean) => void
  setFollowZoomLevel: (zoomLevel: number) => void
}

export function useCameraPreviewGestures({
  cameraRefs,
  cameraFix,
  followGps,
  gpsCamera,
  historyActive,
  perspectiveEnabled,
  applyLiveFollowCamera,
  enterCameraMode,
  getFollowHeadingDeg,
  getLiveFollowCamera,
  setFollowGps,
  setFollowZoomLevel,
}: UseCameraPreviewGesturesParams) {
  const { cameraRef, currentCameraRef, engine, lastFollowKeyRef, previewPanActiveRef } = cameraRefs
  const previewPanBaseRef = useRef<CameraSnapshot | null>(null)
  const previewZoomBaseRef = useRef<CameraSnapshot | null>(null)
  /** Whether the drag started from live follow, so a cancel returns to the live camera. */
  const previewPanFollowedRef = useRef(false)
  const imperativeHandleLatest = {
    applyLiveFollowCamera,
    followGps,
    getFollowHeadingDeg,
    getLiveFollowCamera,
    gpsCamera,
    historyActive,
    perspectiveEnabled,
    setFollowGps,
    setFollowZoomLevel,
  }
  const imperativeHandleLatestRef = useRef(imperativeHandleLatest)
  useLayoutEffect(() => {
    imperativeHandleLatestRef.current = imperativeHandleLatest
  })

  const beginPreviewPan = useCallback(() => {
    const {
      followGps,
      getFollowHeadingDeg,
      gpsCamera,
      historyActive,
      perspectiveEnabled,
      setFollowGps,
    } = imperativeHandleLatestRef.current
    previewPanActiveRef.current = true
    previewPanFollowedRef.current = followGps && !historyActive
    // Anchor on what is actually on screen, not on the camera live follow would
    // like to be at: grabbing the map mid-ride must not teleport it first.
    previewPanBaseRef.current = currentCameraRef.current ?? {
      ...gpsCamera,
      heading: getFollowHeadingDeg(),
      pitch: getPitchForZoom(gpsCamera.zoomLevel, perspectiveEnabled),
    }
    setFollowGps(false)
  }, [currentCameraRef, previewPanActiveRef])

  const previewPanBy = useCallback(
    (deltaX: number, deltaY: number, revealProgress: number) => {
      const { perspectiveEnabled, setFollowGps } = imperativeHandleLatestRef.current
      setFollowGps(false)
      const baseCamera = previewPanBaseRef.current
      if (!baseCamera) return
      const zoomLevel = clamp(
        baseCamera.zoomLevel - MAP_REVEAL_ZOOM_OUT_DELTA * revealProgress,
        MIN_ZOOM,
        MAP_DEFAULTS.maxZoom,
      )
      // Project the drag at the zoom the map is actually rendering, not the one
      // it started at: the reveal zooms out, and projecting at the base zoom
      // moves the ground too little, so the map crawls behind the finger.
      const previewCamera = {
        ...getCameraAfterScreenDrag({ ...baseCamera, zoomLevel }, deltaX, deltaY),
        zoomLevel,
        pitch: getMapRevealPitch({
          basePitch: baseCamera.pitch,
          zoom: zoomLevel,
          revealProgress,
          perspectiveEnabled,
        }),
      }
      currentCameraRef.current = previewCamera
      // Engine shadow-tracks the drag so a later release blends out of the
      // gesture's velocity instead of jumping.
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
    [cameraRef, currentCameraRef, engine],
  )

  const endPreviewPan = useCallback(() => {
    imperativeHandleLatestRef.current.setFollowGps(false)
    previewPanActiveRef.current = false
    previewPanFollowedRef.current = false
    previewPanBaseRef.current = null
    // The drag committed to map mode and nothing retargets right away. Coast
    // the gesture's velocity out instead of stopping dead on the last sample,
    // and leave the springs at rest so a later target starts fresh.
    engine.release()
    // Centre and zoom carry the fling; pitch does not. It is derived from zoom,
    // and the reveal already ended on that value — coasting it on the drag's
    // pitch rate only overshoots the profile, the faster the drag the further.
    const current = currentCameraRef.current
    if (current) {
      engine.setTarget({
        pitch: getPitchForZoom(
          current.zoomLevel,
          imperativeHandleLatestRef.current.perspectiveEnabled,
        ),
      })
    }
  }, [currentCameraRef, engine, previewPanActiveRef])

  const beginPreviewZoom = useCallback(() => {
    const { followGps, getLiveFollowCamera, historyActive } = imperativeHandleLatestRef.current
    previewZoomBaseRef.current =
      followGps && !historyActive ? getLiveFollowCamera() : currentCameraRef.current
  }, [currentCameraRef])

  const previewZoomBy = useCallback((scale: number) => {
    const { applyLiveFollowCamera, followGps, historyActive, setFollowZoomLevel } =
      imperativeHandleLatestRef.current
    const baseCamera = previewZoomBaseRef.current
    if (!baseCamera || scale <= 0) return
    const zoomLevel = clamp(baseCamera.zoomLevel + Math.log2(scale), MIN_ZOOM, MAP_DEFAULTS.maxZoom)
    setFollowZoomLevel(zoomLevel)
    if (followGps && !historyActive) {
      applyLiveFollowCamera()
    }
  }, [])

  const endPreviewZoom = useCallback(() => {
    void imperativeHandleLatestRef.current
    previewZoomBaseRef.current = null
  }, [])

  const restorePreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    enterCameraMode({ kind: 'liveFollow' })
    // A cancelled drag returns to live follow, so ride back to where the rider
    // is now — the camera captured at drag start is already stale by a fix or two.
    const restoreCamera =
      previewPanFollowedRef.current || !previewPanBaseRef.current
        ? getLiveFollowCamera()
        : previewPanBaseRef.current
    previewPanFollowedRef.current = false
    previewPanBaseRef.current = null
    if (cameraFix) {
      lastFollowKeyRef.current = liveFollowKey(cameraFix.timestamp, restoreCamera)
    }
    // The engine shadow-tracked the pan, so the return ride starts from the
    // gesture's position and velocity — no snap on release.
    engine.setTarget({
      center: restoreCamera.centerCoordinate,
      zoom: restoreCamera.zoomLevel,
      heading: restoreCamera.heading,
      pitch: restoreCamera.pitch,
      padding: restoreCamera.padding,
    })
  }, [
    cameraFix,
    engine,
    enterCameraMode,
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
