import { router } from 'expo-router'

import type { OpenRecordRide } from '@/modules/profile/hooks/useProfileStatItems'
import { rideHref } from '@/navigation/links'

/** Opens the ride that set a profile record, on its peak when the record is a moment. */
export const openRecordRide: OpenRecordRide = (rideId, record) => {
  router.dismissTo(rideHref({ rideId, focus: record === 'topSpeed' ? 'topSpeed' : null }))
}
