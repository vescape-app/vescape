import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'

import { useRideDeepLinkStore } from '@/modules/history/store/rideDeepLinkStore'
import { routes } from '@/navigation/routes'

/**
 * Deep-link target of a ride summary notification (#410): `vescape://history/ride/<recordingId>`.
 * Ride History detail is part of the main screen, so this route only hands the recording id over
 * and returns home, where the ride is loaded and selected.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RideSummary.kt `RideSummaryLink`
 * @parity /modules/vescape-core/ios/recording/RideSummary.swift `RideSummaryLink`
 */
export default function RideDeepLinkRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>()

  useEffect(() => {
    if (rideId) useRideDeepLinkStore.getState().requestRide(rideId)
    router.replace(routes.home)
  }, [rideId])

  return null
}
