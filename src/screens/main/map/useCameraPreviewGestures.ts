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

/** Live follow only counts while a fix backs it: otherwise the follow camera is a fallback guess. */
function followingLive(latest: {
  cameraFix: GpsFix | null
  followGps: boolean
  historyActive: boolean
}) {
  return latest.cameraFix != null && latest.followGps && !latest.historyActive
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
  /** Whether the pinch actually drove the camera. Its handler also begins on a plain one-finger
   * drag, and tearing a zoom down there would stomp the pan's own spring back to position. */
  const previewZoomedRef = useRef(false)
  /** Whether the drag started from live follow, so a cancel returns to the live camera. */
  const previewPanFollowedRef = useRef(false)
  const imperativeHandleLatest = {
    applyLiveFollowCamera,
    cameraFix,
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
    const latest = imperativeHandleLatestRef.current
    previewPanActiveRef.current = true
    previewPanFollowedRef.current = latest.followGps && !latest.historyActive
    // Anchor on what is actually on screen, not on the camera live follow would
    // like to be at: grabbing the map mid-ride must not teleport it first.
    previewPanBaseRef.current = currentCameraRef.current ?? {
      ...latest.gpsCamera,
      heading: latest.getFollowHeadingDeg(),
      pitch: getPitchForZoom(latest.gpsCamera.zoomLevel, latest.perspectiveEnabled),
    }
    latest.setFollowGps(false)
  }, [currentCameraRef, previewPanActiveRef])

  const previewPanBy = useCallback(
    (deltaX: number, deltaY: number, revealProgress: number) => {
      const latest = imperativeHandleLatestRef.current
      latest.setFollowGps(false)
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
          perspectiveEnabled: latest.perspectiveEnabled,
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
    const latest = imperativeHandleLatestRef.current
    previewZoomedRef.current = false
    previewZoomBaseRef.current = followingLive(latest)
      ? latest.getLiveFollowCamera()
      : currentCameraRef.current
  }, [currentCameraRef])

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
      // Drive the camera the way the reveal pan does instead of retargeting the springs. A spring
      // target trails the fingers by its own time constant, which reads as a sluggish pinch — and
      // the follow zoom it would ride on is a render behind anyway.
      const followCamera = followingLive(latest) ? latest.getLiveFollowCamera() : baseCamera
      const previewCamera = {
        ...followCamera,
        zoomLevel,
        pitch: getPitchForZoom(zoomLevel, latest.perspectiveEnabled),
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
    [cameraFix, cameraRef, currentCameraRef, engine, lastFollowKeyRef],
  )

  const endPreviewZoom = useCallback(() => {
    previewZoomBaseRef.current = null
    if (!previewZoomedRef.current) return
    previewZoomedRef.current = false
    const latest = imperativeHandleLatestRef.current
    // Leave gesture drive, then pin the zoom to where the fingers left it. Releasing alone coasts
    // every axis on the gesture's velocity, and a pinch that ends while still spreading would keep
    // zooming after the fingers are gone.
    engine.release()
    const current = currentCameraRef.current
    if (current) {
      engine.setTarget({
        zoom: current.zoomLevel,
        pitch: getPitchForZoom(current.zoomLevel, latest.perspectiveEnabled),
      })
    }
    if (followingLive(latest)) latest.applyLiveFollowCamera()
  }, [currentCameraRef, engine])

  const restorePreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    enterCameraMode({ kind: 'liveFollow' })
    // A cancelled drag returns to live follow, so ride back to where the rider is now — the
    // camera captured at drag start is already stale by a fix or two. Without a fix there is no
    // rider to ride back to, and live follow would answer with the fallback camera, a whole
    // continent's worth of zoom out: stay on the drag's own anchor instead.
    const wantsLive = previewPanFollowedRef.current || !previewPanBaseRef.current
    const restoreCamera =
      cameraFix == null
        ? (previewPanBaseRef.current ?? currentCameraRef.current)
        : wantsLive
          ? getLiveFollowCamera()
          : previewPanBaseRef.current
    previewPanFollowedRef.current = false
    previewPanBaseRef.current = null
    if (!restoreCamera) return
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
    currentCameraRef,
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
