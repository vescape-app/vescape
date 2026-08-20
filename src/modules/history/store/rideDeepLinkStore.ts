import { create } from 'zustand'

interface RideDeepLinkState {
  /** Recording id a deep link asked for, until the main screen has opened that ride. */
  pendingRideId: string | null
  requestRide: (rideId: string) => void
  clearPendingRide: () => void
}

/**
 * A ride-summary notification tap (#410) names a recording id, but Ride History detail lives on the
 * main screen rather than on a route of its own. The `history/ride/[rideId]` route parks the id
 * here and bounces home; the main screen consumes it once its history pages are loaded.
 */
export const useRideDeepLinkStore = create<RideDeepLinkState>((set) => ({
  pendingRideId: null,
  requestRide: (rideId) => set({ pendingRideId: rideId }),
  clearPendingRide: () => set({ pendingRideId: null }),
}))
