import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native'
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { NativeSyntheticEvent } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { distanceMeters } from '@/helpers/mapGeometry'
import type { MapCameraControllerState } from '@/modules/map/lib/cameraController'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'
import { getLiveFollowCameraProfile, getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import { toDirectCamera } from '@/modules/map/lib/directCamera'
import { mainMapCameraProbe } from '@/modules/map/screens/benchmark/cameraProbe'
import { shouldPreserveLiveFollowGesture } from '@/modules/map/lib/cameraGestureState'
import type { MainViewState } from '@/screens/main/mainViewState'
import type { CameraSnapshot, HistoryPreviewTarget } from '@/screens/main/map/useCameraControls'
import type { GpsFix } from '@/screens/main/map/cameraControlTypes'
import type { MapPose } from '@/modules/map/components/GpsPuck'

export function useMainMapCameraEvents({
  cameraRef,
  controllerStateRef,
  currentCameraRef,
  engine,
  previewPanActiveRef,
  cameraFix,
  gpsCameraCenter,
  followGps,
  getFollowHeadingDeg,
  headingFollowMode,
  historyActive,
  historyPreview,
  mode,
  perspectiveEnabled,
  phoneHeadingMode,
  mediaAssetCount,
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
  mapPose,
  setCameraReady,
  setCameraZoom,
}: {
  cameraRef: RefObject<CameraRef | null>
  controllerStateRef: RefObject<MapCameraControllerState>
  currentCameraRef: RefObject<CameraSnapshot | null>
  engine: CameraEngine
  previewPanActiveRef: RefObject<boolean>
  cameraFix: GpsFix | null
  gpsCameraCenter: [number, number]
  followGps: boolean
  getFollowHeadingDeg: () => number
  headingFollowMode: boolean
  historyActive: boolean
  historyPreview: ({ key: string } & HistoryPreviewTarget) | null
  mode: MainViewState
  perspectiveEnabled: boolean
  phoneHeadingMode: boolean
  mediaAssetCount: number
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
  mapPose: SharedValue<MapPose>
  setCameraReady: Dispatch<SetStateAction<boolean>>
  setCameraZoom: Dispatch<SetStateAction<number>>
}) {
  const handleMapLoaded = useCallback(
    (preserveCamera: boolean) => {
      // A style replacement keeps the native camera and engine. Only initialize a new map view.
      if (preserveCamera) return
      // Whatever the controller last decided still stands; a style load is not a reason to hand the
      // camera back to live follow when the rider is looking at the weather, a route, or a ride.
      const camera =
        historyActive && historyPreview
          ? getHistoryPreviewCamera(historyPreview)
          : controllerStateRef.current.mode.kind === 'liveFollow' ||
              currentCameraRef.current == null
            ? getLiveFollowCamera()
            : currentCameraRef.current
      const initialHeading =
        'heading' in camera && typeof camera.heading === 'number'
          ? camera.heading
          : historyActive
            ? 0
            : getFollowHeadingDeg()
      const initialPitch = getPitchForZoom(camera.zoomLevel, perspectiveEnabled)
      cameraRef.current?.setCameraDirect(
        toDirectCamera({
          center: camera.centerCoordinate,
          zoom: camera.zoomLevel,
          heading: initialHeading,
          pitch: initialPitch,
          padding: 'padding' in camera ? camera.padding : undefined,
        }),
      )
      // Park the springs on the load camera so the first target animates from it.
      engine.reset({
        centerCoordinate: camera.centerCoordinate,
        zoomLevel: camera.zoomLevel,
        heading: initialHeading,
        pitch: initialPitch,
        padding: 'padding' in camera ? camera.padding : undefined,
      })
    },
    [
      cameraRef,
      controllerStateRef,
      currentCameraRef,
      engine,
      getFollowHeadingDeg,
      getHistoryPreviewCamera,
      getLiveFollowCamera,
      historyActive,
      historyPreview,
      perspectiveEnabled,
    ],
  )

  const handleCameraChanged = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const [longitude, latitude] = nativeEvent.center
      const { zoom, bearing: heading, pitch } = nativeEvent
      // MapLibre reports `userInteraction` for a gesture and its deceleration; the echo of a direct
      // camera write never carries it (patched, see #642).
      const gestureActive = nativeEvent.userInteraction
      mapPose.set({ heading, pitch })
      const automaticHeadingFollow = followGps && headingFollowMode && !gestureActive
      const camera = {
        centerCoordinate: [longitude, latitude],
        zoomLevel: zoom,
        heading,
        pitch,
      } satisfies CameraSnapshot
      mainMapCameraProbe.current?.echo({ center: [longitude, latitude], zoom, heading, pitch })
      onWatchRouteSpanChange(latitude, zoom)
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
        engine.driveExternal(camera, { gesture: gestureActive })
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
        const profilePitch = getPitchForZoom(zoom, perspectiveEnabled)
        if (Math.abs(pitch - profilePitch) > 0.5) {
          cameraRef.current?.setCameraDirect({ pitch: profilePitch })
        }
      }
      if (gestureActive) {
        const gestureCenterDistanceM = cameraFix
          ? distanceMeters({ longitude, latitude }, cameraFix)
          : Number.POSITIVE_INFINITY
        const preservesLiveFollow = shouldPreserveLiveFollowGesture({
          followGps,
          historyActive,
          centerDistanceM: gestureCenterDistanceM,
          headingDeg: heading,
          followHeadingDeg: getFollowHeadingDeg(),
        })
        if (preservesLiveFollow) {
          setFollowZoomLevel(zoom)
          const followCamera = getLiveFollowCameraProfile({
            gpsCamera: {
              centerCoordinate: [longitude, latitude],
              zoomLevel: zoom,
            },
            followHeadingDeg: getFollowHeadingDeg(),
            gpsHeadingMode: headingFollowMode,
            profileKey: phoneHeadingMode ? 'compass' : undefined,
            perspectiveEnabled,
          })
          if (Math.abs(pitch - followCamera.pitch) > 0.5) {
            cameraRef.current?.setCameraDirect({ pitch: followCamera.pitch })
          }
        } else {
          setFollowGps(false)
        }
      }
      if (!automaticHeadingFollow) {
        onHeadingChange(heading)
        updateOffscreenMapIndicators()
      } else {
        // Heading follow skips the per-frame check, and MapLibre reports no idle after a direct
        // camera write, so without this nothing re-reads visibility once the camera arrives: an
        // indicator raised while the camera was still travelling stays over a visible point.
        scheduleOffscreenMapIndicatorRefresh()
      }
      if (historyActive && mediaAssetCount > 0) {
        setCameraZoom((current) => (Math.abs(current - zoom) > 0.25 ? zoom : current))
      }
    },
    [
      mapPose,
      cameraRef,
      cameraFix,
      currentCameraRef,
      engine,
      followGps,
      getFollowHeadingDeg,
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
      scheduleOffscreenMapIndicatorRefresh,
      setFollowGps,
      setFollowZoomLevel,
      setCameraReady,
      setCameraZoom,
      updateOffscreenMapIndicators,
    ],
  )

  const handleMapIdle = useCallback(() => {
    const camera = currentCameraRef.current
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
  ])

  return { handleMapLoaded, handleCameraChanged, handleMapIdle }
}
