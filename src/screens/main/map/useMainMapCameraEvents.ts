import type { Camera } from '@rnmapbox/maps'
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import { distanceMeters } from '@/helpers/mapGeometry'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'
import { getLiveFollowCameraProfile, getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import { shouldPreserveLiveFollowGesture } from '@/modules/map/lib/cameraGestureState'
import type { MainViewState } from '@/screens/main/mainViewState'
import type { CameraSnapshot, HistoryPreviewTarget } from '@/screens/main/map/useCameraControls'
import type { GpsFix } from '@/screens/main/map/cameraControlTypes'

export function useMainMapCameraEvents({
  cameraRef,
  currentCameraRef,
  engine,
  previewPanActiveRef,
  cameraFix,
  gpsCameraCenter,
  followGps,
  followHeadingDeg,
  headingFollowMode,
  historyActive,
  historyPreview,
  mode,
  perspectiveEnabled,
  phoneHeadingMode,
  mediaAssetCount,
  mapStyleKey,
  mapStyleSignature,
  getHistoryPreviewCamera,
  getLiveFollowCamera,
  setFollowGps,
  setFollowZoomLevel,
  onCameraSettled,
  onWatchRouteSpanChange,
  onHeadingChange,
  repositionOffscreenIndicatorsForCamera,
  scheduleOffscreenMapIndicatorRefresh,
  updateOffscreenMapIndicators,
  setCameraHeading,
  setCameraReady,
  setCameraZoom,
  setLoadedStyleSignature,
}: {
  cameraRef: RefObject<Camera | null>
  currentCameraRef: RefObject<CameraSnapshot | null>
  engine: CameraEngine
  previewPanActiveRef: RefObject<boolean>
  cameraFix: GpsFix | null
  gpsCameraCenter: [number, number]
  followGps: boolean
  followHeadingDeg: number
  headingFollowMode: boolean
  historyActive: boolean
  historyPreview: ({ key: string } & HistoryPreviewTarget) | null
  mode: MainViewState
  perspectiveEnabled: boolean
  phoneHeadingMode: boolean
  mediaAssetCount: number
  mapStyleKey: string
  mapStyleSignature: string
  getHistoryPreviewCamera: (preview: HistoryPreviewTarget) => CameraSnapshot
  getLiveFollowCamera: () => CameraSnapshot
  setFollowGps: (follow: boolean) => void
  setFollowZoomLevel: (zoom: number) => void
  onCameraSettled: (latitude: number, longitude: number, zoom: number) => void
  /** Wrist route scale, per camera frame and once more when the map comes to rest. */
  onWatchRouteSpanChange: (latitude: number, zoom: number) => void
  onHeadingChange: (heading: number) => void
  repositionOffscreenIndicatorsForCamera: (camera: CameraSnapshot) => void
  scheduleOffscreenMapIndicatorRefresh: () => void
  updateOffscreenMapIndicators: () => void
  setCameraHeading: Dispatch<SetStateAction<number>>
  setCameraReady: Dispatch<SetStateAction<boolean>>
  setCameraZoom: Dispatch<SetStateAction<number>>
  setLoadedStyleSignature: Dispatch<SetStateAction<string | null>>
}) {
  const styleReloadCameraRef = useRef<CameraSnapshot | null>(null)
  const previousMapStyleKeyRef = useRef(mapStyleKey)
  const gestureActiveRef = useRef(false)

  useEffect(() => {
    if (previousMapStyleKeyRef.current === mapStyleKey) return
    previousMapStyleKeyRef.current = mapStyleKey
    styleReloadCameraRef.current = currentCameraRef.current
  }, [currentCameraRef, mapStyleKey])

  const handleMapLoaded = useCallback(() => {
    setLoadedStyleSignature(mapStyleSignature)
    const styleReloadCamera = styleReloadCameraRef.current
    styleReloadCameraRef.current = null
    if (styleReloadCamera && gestureActiveRef.current) return
    const camera =
      historyActive && historyPreview
        ? getHistoryPreviewCamera(historyPreview)
        : (styleReloadCamera ?? getLiveFollowCamera())
    const initialHeading =
      'heading' in camera && typeof camera.heading === 'number'
        ? camera.heading
        : historyActive
          ? 0
          : followHeadingDeg
    const initialPitch = styleReloadCamera
      ? styleReloadCamera.pitch
      : getPitchForZoom(camera.zoomLevel, perspectiveEnabled)
    cameraRef.current?.setCamera({
      ...camera,
      heading: initialHeading,
      pitch: initialPitch,
      animationDuration: 0,
    })
    // Park the springs on the load camera so the first target animates from it.
    engine.reset({
      centerCoordinate: camera.centerCoordinate,
      zoomLevel: camera.zoomLevel,
      heading: initialHeading,
      pitch: initialPitch,
      padding: 'padding' in camera ? camera.padding : undefined,
    })
  }, [
    cameraRef,
    engine,
    followHeadingDeg,
    getHistoryPreviewCamera,
    getLiveFollowCamera,
    historyActive,
    historyPreview,
    mapStyleSignature,
    perspectiveEnabled,
    setLoadedStyleSignature,
  ])

  const handleCameraChanged = useCallback(
    (state: {
      properties: { center: number[]; zoom: number; heading: number; pitch: number }
      gestures: { isGestureActive: boolean }
    }) => {
      gestureActiveRef.current = state.gestures.isGestureActive
      const [longitude, latitude] = state.properties.center
      const automaticHeadingFollow =
        followGps && headingFollowMode && !state.gestures.isGestureActive
      const camera = {
        centerCoordinate: [longitude, latitude],
        zoomLevel: state.properties.zoom,
        heading: state.properties.heading,
        pitch: state.properties.pitch,
      } satisfies CameraSnapshot
      onWatchRouteSpanChange(latitude, state.properties.zoom)
      // The reveal gesture writes the camera and drives the engine itself; its
      // echoes arrive a frame late and would only add phantom velocity.
      const previewPanActive = previewPanActiveRef.current
      if (!previewPanActive) currentCameraRef.current = camera
      // While a native gesture (or any non-engine mover) owns the camera, the
      // engine shadow-tracks it so its next target blends from here. Telling it
      // whether a finger is down is the whole filter: the engine discards the
      // echoes of its own writes itself, which it can do accurately and this
      // callback cannot.
      if (!previewPanActive) {
        engine.driveExternal(camera, { gesture: state.gestures.isGestureActive })
      }
      repositionOffscreenIndicatorsForCamera(camera)
      const [targetLongitude, targetLatitude] = gpsCameraCenter
      if (
        Math.abs(longitude - targetLongitude) < 0.0001 &&
        Math.abs(latitude - targetLatitude) < 0.0001
      ) {
        setCameraReady(true)
      }
      // Keep pitch on the zoom profile when something outside the engine moved
      // the camera — a native pinch, mostly. Never while the engine animates:
      // it writes pitch from its own spring every frame, and a direct write here
      // would be overwritten on the next one, the two of them vibrating against
      // each other until the spring settles.
      if (
        !previewPanActive &&
        !engine.isAnimating() &&
        mode === 'map' &&
        !(followGps && headingFollowMode)
      ) {
        const pitch = getPitchForZoom(state.properties.zoom, perspectiveEnabled)
        if (Math.abs(state.properties.pitch - pitch) > 0.5) {
          cameraRef.current?.setCameraDirect({ pitch })
        }
      }
      if (state.gestures.isGestureActive) {
        const gestureCenterDistanceM = cameraFix
          ? distanceMeters({ longitude, latitude }, cameraFix)
          : Number.POSITIVE_INFINITY
        const preservesLiveFollow = shouldPreserveLiveFollowGesture({
          followGps,
          historyActive,
          centerDistanceM: gestureCenterDistanceM,
          headingDeg: state.properties.heading,
          followHeadingDeg,
        })
        if (preservesLiveFollow) {
          setFollowZoomLevel(state.properties.zoom)
          const followCamera = getLiveFollowCameraProfile({
            gpsCamera: {
              centerCoordinate: [longitude, latitude],
              zoomLevel: state.properties.zoom,
            },
            followHeadingDeg,
            gpsHeadingMode: headingFollowMode,
            profileKey: phoneHeadingMode ? 'compass' : undefined,
            perspectiveEnabled,
          })
          if (Math.abs(state.properties.pitch - followCamera.pitch) > 0.5) {
            cameraRef.current?.setCameraDirect({ pitch: followCamera.pitch })
          }
        } else {
          setFollowGps(false)
        }
      }
      if (!automaticHeadingFollow) {
        onHeadingChange(state.properties.heading)
        updateOffscreenMapIndicators()
      }
      if (historyActive && mediaAssetCount > 0) {
        setCameraZoom((current) =>
          Math.abs(current - state.properties.zoom) > 0.25 ? state.properties.zoom : current,
        )
      }
    },
    [
      cameraRef,
      cameraFix,
      currentCameraRef,
      engine,
      followGps,
      followHeadingDeg,
      gpsCameraCenter,
      headingFollowMode,
      historyActive,
      mode,
      onHeadingChange,
      onWatchRouteSpanChange,
      mediaAssetCount,
      perspectiveEnabled,
      phoneHeadingMode,
      previewPanActiveRef,
      repositionOffscreenIndicatorsForCamera,
      setFollowGps,
      setFollowZoomLevel,
      setCameraReady,
      setCameraZoom,
      updateOffscreenMapIndicators,
    ],
  )

  const handleMapIdle = useCallback(() => {
    const camera = currentCameraRef.current
    const heading = camera?.heading
    if (heading != null) setCameraHeading(heading)
    scheduleOffscreenMapIndicatorRefresh()
    // Map Points live on the server, so the visible set is read per camera rest.
    if (camera) {
      const [longitude, latitude] = camera.centerCoordinate
      onCameraSettled(latitude, longitude, camera.zoomLevel)
      onWatchRouteSpanChange(latitude, camera.zoomLevel)
    }
  }, [
    currentCameraRef,
    onCameraSettled,
    onWatchRouteSpanChange,
    scheduleOffscreenMapIndicatorRefresh,
    setCameraHeading,
  ])

  return { handleMapLoaded, handleCameraChanged, handleMapIdle }
}
