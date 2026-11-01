import { useEffect } from 'react'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { publicRideMapCoordinates } from './publicRideMapFraming'
import { usePublicRidePrototypeStore } from '@/modules/group-ride/components/public-ride-prototype/prototypeStore'

/** One framing per explicit Social action; live fixes never keep pulling the camera back. */
export function usePublicRideMapFraming({
  active,
  riders,
  selfLocation,
  fitRoute,
}: {
  active: boolean
  riders: RosterRider[]
  selfLocation: { longitude: number; latitude: number } | null
  fitRoute: (coordinates: [number, number][]) => void
}) {
  const request = usePublicRidePrototypeStore((state) => state.mapRequest)
  useEffect(() => {
    if (!__DEV__ || !active || !request) return
    const coordinates = publicRideMapCoordinates(request, riders, selfLocation)
    if (!coordinates) return
    fitRoute(coordinates)
    usePublicRidePrototypeStore.getState().clearMapRequest(request)
  }, [active, request, riders, selfLocation, fitRoute])
}
