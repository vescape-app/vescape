import type Mapbox from '@rnmapbox/maps'
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react'

import {
  applyOffscreenIndicatorDrafts,
  clampedEdgeIndicator,
  projectCoordinateToEdgePoint,
  repositionOffscreenMapIndicators,
  type OffscreenMapIndicatorDraft,
  type MapLayout,
  type OffscreenMapIndicatorState,
  type TrackedMapPoint,
} from '@/screens/main/map/offscreenMapIndicators'
import type { CameraSnapshot } from '@/screens/main/map/useCameraControls'

const OFFSCREEN_INDICATOR_VISIBILITY_CHECK_MS = 200

/**
 * Owns the edge indicators for tracked points that fall outside the viewport.
 *
 * State is mirrored in a ref and published only when the indicator set actually changes
 * identity: repositioning writes into shared values in place, so the common camera-frame
 * path costs no React render.
 */
export function useOffscreenMapIndicators({
  mapViewRef,
  currentCameraRef,
  mapLayout,
  trackedPoints,
  enabled,
}: {
  mapViewRef: RefObject<ComponentRef<typeof Mapbox.MapView> | null>
  currentCameraRef: RefObject<CameraSnapshot | null>
  mapLayout: MapLayout
  trackedPoints: TrackedMapPoint[]
  enabled: boolean
}) {
  const [indicators, setIndicators] = useState<OffscreenMapIndicatorState[]>([])
  const indicatorsRef = useRef<OffscreenMapIndicatorState[]>([])
  const projectionRequestRef = useRef(0)
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publish = useCallback((next: OffscreenMapIndicatorState[]) => {
    indicatorsRef.current = next
    setIndicators(next)
  }, [])

  const applyDrafts = useCallback(
    (drafts: OffscreenMapIndicatorDraft[]) => {
      const current = indicatorsRef.current
      const next = applyOffscreenIndicatorDrafts(current, drafts)
      if (next !== current) publish(next)
    },
    [publish],
  )

  const clear = useCallback(() => {
    if (indicatorsRef.current.length === 0) return
    publish([])
  }, [publish])

  const update = useCallback(() => {
    const mapView = mapViewRef.current
    if (
      mapView == null ||
      !enabled ||
      trackedPoints.length === 0 ||
      mapLayout.width <= 0 ||
      mapLayout.height <= 0
    ) {
      projectionRequestRef.current += 1
      clear()
      return
    }

    const requestId = projectionRequestRef.current + 1
    projectionRequestRef.current = requestId

    void Promise.all(
      trackedPoints.map(async (trackedPoint) => ({
        ...trackedPoint,
        point: await mapView.getPointInView(trackedPoint.coordinate),
      })),
    )
      .then((projectedPoints) => {
        if (projectionRequestRef.current !== requestId) return
        // Read the camera after the native projection resolves: a snapshot taken before the await
        // is a frame or more old, and re-projecting against it drags the indicators back to a
        // heading the map has already left.
        const camera = currentCameraRef.current
        const next = projectedPoints.flatMap((trackedPoint) => {
          const [x, y] = trackedPoint.point
          if (typeof x !== 'number' || typeof y !== 'number') return []

          const detectedIndicator = clampedEdgeIndicator(trackedPoint, { x, y }, mapLayout)
          if (!detectedIndicator) return []
          if (!camera) return [detectedIndicator]

          const positionedPoint = projectCoordinateToEdgePoint(
            {
              longitude: trackedPoint.coordinate[0],
              latitude: trackedPoint.coordinate[1],
            },
            camera,
            mapLayout,
          )
          const positionedIndicator = clampedEdgeIndicator(trackedPoint, positionedPoint, mapLayout)
          return [positionedIndicator ?? detectedIndicator]
        })
        applyDrafts(next)
      })
      .catch(() => {
        if (projectionRequestRef.current !== requestId) return
        clear()
      })
  }, [applyDrafts, clear, currentCameraRef, enabled, mapLayout, mapViewRef, trackedPoints])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null
      update()
    }, OFFSCREEN_INDICATOR_VISIBILITY_CHECK_MS)
  }, [update])

  /** Reposition against a camera without re-projecting through the native map view. */
  const repositionForCamera = useCallback(
    (camera: CameraSnapshot) => {
      const repositioned = repositionOffscreenMapIndicators(
        indicatorsRef.current,
        camera,
        mapLayout,
      )
      if (repositioned !== indicatorsRef.current) publish(repositioned)
    },
    [mapLayout, publish],
  )

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    },
    [],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [update])

  return { indicators, update, scheduleRefresh, repositionForCamera }
}
