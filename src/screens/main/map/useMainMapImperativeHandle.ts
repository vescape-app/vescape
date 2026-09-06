import { useImperativeHandle, useLayoutEffect, useRef } from 'react'

import type { CameraSnapshot, HistoryPreviewTarget } from '@/modules/map/lib/cameraMotion'
import type { useCameraIntentCommands } from '@/screens/main/map/useCameraIntentCommands'
import type { useCameraPreviewGestures } from '@/screens/main/map/useCameraPreviewGestures'
import type { MainMapHandle } from '@/screens/main/map/MainMap'

/**
 * The map's imperative API. Every method reads the latest closures through a ref, so the handle
 * itself is created once and callers never hold a stale camera.
 */
export function useMainMapImperativeHandle(
  ref: React.Ref<MainMapHandle>,
  latest: {
    currentCameraRef: React.RefObject<CameraSnapshot | null>
    getViewfinderCoordinateFromMap?: () => Promise<{ longitude: number; latitude: number } | null>
    gpsCamera: { centerCoordinate: [number, number] }
    intentCommands: ReturnType<typeof useCameraIntentCommands>
    previewGestures: ReturnType<typeof useCameraPreviewGestures>
    previewHistorySession: (preview: HistoryPreviewTarget) => void
    recenterLive: (options?: { resetPadding?: boolean; animationDuration?: number }) => void
  },
) {
  const imperativeHandleLatestRef = useRef(latest)
  useLayoutEffect(() => {
    imperativeHandleLatestRef.current = latest
  })
  useImperativeHandle(
    ref,
    () => ({
      recenterLive(options?: { resetPadding?: boolean; animationDuration?: number }) {
        imperativeHandleLatestRef.current.recenterLive(options)
      },
      previewHistorySession(preview: HistoryPreviewTarget) {
        imperativeHandleLatestRef.current.previewHistorySession(preview)
      },
      beginPreviewPan() {
        imperativeHandleLatestRef.current.previewGestures.beginPreviewPan()
      },
      previewPanBy(...args: [number, number, number]) {
        imperativeHandleLatestRef.current.previewGestures.previewPanBy(...args)
      },
      endPreviewPan() {
        imperativeHandleLatestRef.current.previewGestures.endPreviewPan()
      },
      beginPreviewZoom() {
        imperativeHandleLatestRef.current.previewGestures.beginPreviewZoom()
      },
      previewZoomBy(scale: number) {
        imperativeHandleLatestRef.current.previewGestures.previewZoomBy(scale)
      },
      endPreviewZoom() {
        imperativeHandleLatestRef.current.previewGestures.endPreviewZoom()
      },
      restorePreviewPan() {
        imperativeHandleLatestRef.current.previewGestures.restorePreviewPan()
      },
      async getViewfinderCoordinate() {
        const { currentCameraRef, getViewfinderCoordinateFromMap, gpsCamera } =
          imperativeHandleLatestRef.current
        const coordinate = await getViewfinderCoordinateFromMap?.()
        if (coordinate) return coordinate
        const center = currentCameraRef.current?.centerCoordinate ?? gpsCamera.centerCoordinate
        return { longitude: center[0], latitude: center[1] }
      },
      resetRotation() {
        imperativeHandleLatestRef.current.intentCommands.resetRotation()
      },
      togglePerspective() {
        imperativeHandleLatestRef.current.intentCommands.togglePerspective()
      },
      setPadding(bottom: number) {
        imperativeHandleLatestRef.current.intentCommands.setPadding(bottom)
      },
      zoomBy(delta: number) {
        imperativeHandleLatestRef.current.intentCommands.zoomBy(delta)
      },
      focusCoordinate(coordinate: [number, number]) {
        imperativeHandleLatestRef.current.intentCommands.focusCoordinate(coordinate)
      },
      centerCoordinatePreservingCamera(coordinate: [number, number]) {
        imperativeHandleLatestRef.current.intentCommands.centerCoordinatePreservingCamera(
          coordinate,
        )
      },
      focusWeather() {
        imperativeHandleLatestRef.current.intentCommands.focusWeather()
      },
      focusLegalLimits() {
        imperativeHandleLatestRef.current.intentCommands.focusLegalLimits()
      },
    }),
    [],
  )
}
