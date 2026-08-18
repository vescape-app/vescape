import { useCallback, useEffect, useRef, type RefObject } from 'react'

import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import type { CameraEngine } from '@/modules/map/lib/cameraEngine/engine'
import type { DirectionPoint } from '@/modules/map/store/mapStore'
import type { OffscreenMapIndicatorState } from '@/screens/main/map/offscreenMapIndicators'
import { panPreservingCamera } from '@/screens/main/map/panPreservingCamera'
import type { CameraSnapshot } from '@/screens/main/map/useCameraControls'

const RIDER_FOCUS_MIN_ZOOM = 15

export function useMainMapFocusActions({
  engine,
  currentCameraRef,
  historyActive,
  riderFocusRows,
  directionPoint,
  setFollowGps,
  recenterLive,
  onEnterMapMode,
  onMapInteraction,
}: {
  engine: CameraEngine
  currentCameraRef: RefObject<CameraSnapshot | null>
  historyActive: boolean
  riderFocusRows: RosterRider[]
  directionPoint: DirectionPoint | null
  setFollowGps: (follow: boolean) => void
  recenterLive: (options?: { resetPadding?: boolean; animationDuration?: number }) => void
  onEnterMapMode: () => void
  onMapInteraction: () => void
}) {
  const riderFocusRequest = useGroupRideStore((state) => state.focusRequest)
  const focusRider = useGroupRideStore((state) => state.focusRider)
  const handledRiderFocusNonceRef = useRef(0)

  useEffect(() => {
    if (!riderFocusRequest || historyActive) return
    // One camera move per request: rosterRows refresh on every presence tick, so
    // without consuming the nonce this effect would keep re-centering on the rider.
    if (riderFocusRequest.nonce === handledRiderFocusNonceRef.current) return
    const rider = riderFocusRows.find((row) => row.id === riderFocusRequest.riderId)
    if (!rider?.presence) return
    handledRiderFocusNonceRef.current = riderFocusRequest.nonce
    setFollowGps(false)
    panPreservingCamera(engine, currentCameraRef, [rider.presence.lng, rider.presence.lat], {
      minZoomLevel: RIDER_FOCUS_MIN_ZOOM,
    })
  }, [currentCameraRef, engine, historyActive, riderFocusRequest, riderFocusRows, setFollowGps])

  const handleOffscreenIndicatorPress = useCallback(
    (indicator: OffscreenMapIndicatorState) => {
      onMapInteraction()
      if (indicator.id === 'gps') {
        recenterLive({ resetPadding: true })
        return
      }
      if (indicator.type === 'rider') {
        // Same focus flow as tapping a rider in the roster (centers with min zoom).
        focusRider(indicator.id.slice('rider-'.length))
        return
      }
      if (indicator.type === 'direction' && !directionPoint) return
      if (indicator.type === 'mapPoint') onEnterMapMode()

      setFollowGps(false)
      panPreservingCamera(
        engine,
        currentCameraRef,
        indicator.type === 'direction' && directionPoint
          ? [directionPoint.longitude, directionPoint.latitude]
          : indicator.coordinate.value,
      )
    },
    [
      currentCameraRef,
      directionPoint,
      engine,
      focusRider,
      onEnterMapMode,
      onMapInteraction,
      recenterLive,
      setFollowGps,
    ],
  )

  const handleFocusDirectionPoint = useCallback(() => {
    if (!directionPoint) return
    onMapInteraction()
    setFollowGps(false)
    panPreservingCamera(engine, currentCameraRef, [
      directionPoint.longitude,
      directionPoint.latitude,
    ])
  }, [currentCameraRef, directionPoint, engine, onMapInteraction, setFollowGps])

  return { handleOffscreenIndicatorPress, handleFocusDirectionPoint }
}
