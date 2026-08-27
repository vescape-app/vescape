import { useCallback, useLayoutEffect, useRef } from 'react'

import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { getMapRevealPitch, getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
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
  /** The drag owns the camera only while the controller still says so. */
  const ownsCamera = useCallback(
    () => controllerStateRef.current.mode.kind === 'previewPan',
    [controllerStateRef],
  )
  /** Live follow only counts while a fix backs it: otherwise the follow camera is a fallback guess. */
  const followingLive = useCallback(
    () =>
      controllerStateRef.current.mode.kind === 'liveFollow' &&
      imperativeHandleLatestRef.current.cameraFix != null,
    [controllerStateRef],
  )
  const previewPanBaseRef = useRef<CameraSnapshot | null>(null)
  const previewZoomBaseRef = useRef<CameraSnapshot | null>(null)
  /** Whether the pinch actually drove the camera. Its handler also begins on a plain one-finger
   * drag, and tearing a zoom down there would stomp the pan's own spring back to position. */
  const previewZoomedRef = useRef(false)
  const imperativeHandleLatest = {
    applyLiveFollowCamera,
    cameraFix,
    getFollowHeadingDeg,
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
    // Anchor on what is actually on screen, not on the camera live follow would
    // like to be at: grabbing the map mid-ride must not teleport it first.
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
      // Something claimed the camera mid-drag (the weather view, a route fit). It owns the
      // viewport now; the finger stops driving rather than fighting the new target.
      if (!baseCamera || !ownsCamera()) return
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
    [cameraRef, currentCameraRef, engine, ownsCamera],
  )

  const endPreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    previewPanBaseRef.current = null
    const owned = ownsCamera()
    dispatchCameraIntent({ type: 'EndPreviewPan' })
    // Whoever took the camera mid-drag is animating towards its own target; releasing the drag's
    // velocity into it would drag that target off course.
    if (!owned) return
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
      // Drive the camera the way the reveal pan does instead of retargeting the springs. A spring
      // target trails the fingers by its own time constant, which reads as a sluggish pinch — and
      // the follow zoom it would ride on is a render behind anyway.
      const followCamera = followingLive() ? latest.getLiveFollowCamera() : baseCamera
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
    [cameraFix, cameraRef, currentCameraRef, engine, followingLive, lastFollowKeyRef],
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
    if (followingLive()) latest.applyLiveFollowCamera()
  }, [currentCameraRef, engine, followingLive])

  const restorePreviewPan = useCallback(() => {
    previewPanActiveRef.current = false
    const anchorCamera = previewPanBaseRef.current
    previewPanBaseRef.current = null
    // A cancelled drag returns to whatever the drag interrupted, so ride back to where the rider
    // is now — the camera captured at drag start is already stale by a fix or two. The controller
    // decides whether that return still applies: an intent issued mid-drag owns the camera and
    // this cancel becomes a no-op.
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
