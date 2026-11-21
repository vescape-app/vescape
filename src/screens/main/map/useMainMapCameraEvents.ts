import type { Camera } from '@rnmapbox/maps'
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { SharedValue } from 'react-native-reanimated'

import { distanceMeters } from '@/helpers/mapGeometry'
import type { MapCameraControllerState } from '@/modules/map/lib/cameraController'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'
import { getLiveFollowCameraProfile, getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
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
  cameraRef: RefObject<Camera | null>
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
      if (preserveCamera) return
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
      cameraRef.current?.setCamera({
        ...camera,
        heading: initialHeading,
        pitch: initialPitch,
        animationDuration: 0,
      })
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
    (state: {
      properties: { center: number[]; zoom: number; heading: number; pitch: number }
      gestures: { isGestureActive: boolean }
    }) => {
      const [longitude, latitude] = state.properties.center
      mapPose.set({ heading: state.properties.heading, pitch: state.properties.pitch })
      const automaticHeadingFollow =
        followGps && headingFollowMode && !state.gestures.isGestureActive
      const camera = {
        centerCoordinate: [longitude, latitude],
        zoomLevel: state.properties.zoom,
        heading: state.properties.heading,
        pitch: state.properties.pitch,
      } satisfies CameraSnapshot
      onWatchRouteSpanChange(latitude, state.properties.zoom)
      const previewPanActive = previewPanActiveRef.current
      if (!previewPanActive) currentCameraRef.current = camera
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
          followHeadingDeg: getFollowHeadingDeg(),
        })
        if (preservesLiveFollow) {
          setFollowZoomLevel(state.properties.zoom)
          const followCamera = getLiveFollowCameraProfile({
            gpsCamera: {
              centerCoordinate: [longitude, latitude],
              zoomLevel: state.properties.zoom,
            },
            followHeadingDeg: getFollowHeadingDeg(),
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
      } else {
        scheduleOffscreenMapIndicatorRefresh()
      }
      if (historyActive && mediaAssetCount > 0) {
        setCameraZoom((current) =>
          Math.abs(current - state.properties.zoom) > 0.25 ? state.properties.zoom : current,
        )
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
