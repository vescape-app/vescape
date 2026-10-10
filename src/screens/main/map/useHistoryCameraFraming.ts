import { useCallback, useEffect, useRef } from 'react'

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
  /** The stretch the chart is zoomed into, or empty when it shows the whole ride. */
  focusRoute: [number, number][]
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
  focusRoute,
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
    (nextSelectionKey: string | null, route: [number, number][]) => {
      const historyCamera = getRouteFitCamera({
        route,
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
    [dispatchCameraIntent, engine, onHeadingChange, perspectiveEnabled, viewport],
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

  // What the camera was last framed to. Framing is a response to the ride, the chart's zoom or the
  // preview changing — not to this component rendering, and emphatically not to the camera moving:
  // a fit writes the camera, the camera reports back, the map re-renders, and an effect that keyed
  // on its own callbacks would fit again forever. The keys below are what "changed" means here.
  const framedKeyRef = useRef<string | null>(null)
  /** The zoom window already framed, so only a *new* one reclaims a camera the rider has panned. */
  const framedFocusRef = useRef<string>('')
  const framingRef = useRef({ fitRide, previewHistoryRoute, previewHistorySession, preview })
  framingRef.current = { fitRide, previewHistoryRoute, previewHistorySession, preview }

  const focusKey = routeKey(focusRoute)
  const rideKey = routeKey(rideRoute)
  const previewRouteKey = routeKey(previewRoute)
  const previewKey = preview?.key ?? null
  // The panel grows as metrics open, shrinking the map; rounded so layout jitter is not a reframe.
  const insetKey = Math.round(viewport.bottomInset ?? -1)

  useEffect(() => {
    if (!active || !selectionKey) return

    const key = `${selectionKey}|${focusKey}|${rideKey}|${previewRouteKey}|${previewKey}|${insetKey}`
    if (key === framedKeyRef.current) return
    framedKeyRef.current = key

    const mode = controllerStateRef.current.mode
    // Zooming the chart is an explicit request to be shown that stretch of ride, so it reclaims a
    // camera the rider had panned away by hand; opening a metric only reframes what it already owns.
    const reclaim =
      mode.kind === 'rideHistory' && focusKey !== '' && focusKey !== framedFocusRef.current
    framedFocusRef.current = focusKey
    if (mode.kind !== 'rideHistory' || mode.selectionKey !== selectionKey || reclaim) {
      setCameraModeRef({
        kind: 'rideHistory',
        selectionKey,
        phase: 'preview',
      })
    }

    const frame = requestAnimationFrame(() => {
      const framing = framingRef.current
      if (focusRoute.length > 0) {
        framing.fitRide(selectionKey, focusRoute)
        return
      }
      if (rideRoute.length > 0) {
        framing.fitRide(selectionKey, rideRoute)
        return
      }
      if (previewRoute.length > 0) {
        framing.previewHistoryRoute(selectionKey, previewRoute)
        return
      }
      const target = framing.preview
      if (target?.key === selectionKey) {
        framing.previewHistorySession(target)
      }
    })
    return () => cancelAnimationFrame(frame)
    // Framing inputs only. The callbacks live in a ref precisely so a new camera, viewport or
    // heading callback cannot masquerade as a new reason to move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    controllerStateRef,
    focusKey,
    insetKey,
    previewKey,
    previewRouteKey,
    rideKey,
    selectionKey,
    setCameraModeRef,
  ])

  return {
    getHistoryPreviewCamera,
    previewHistorySession,
  }
}

/**
 * Identity of a route as far as framing cares: how many fixes it has and where it starts and ends.
 * Two arrays that agree on those frame to the same camera, whatever rebuilt them.
 */
function routeKey(route: [number, number][]): string {
  const first = route[0]
  const last = route.at(-1)
  if (!first || !last) return ''
  return `${route.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`
}
