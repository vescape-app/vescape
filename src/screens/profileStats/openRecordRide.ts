import { router } from 'expo-router'

import type { OpenRecordRide } from '@/modules/profile/hooks/useProfileStatItems'
import { rideHref } from '@/navigation/links'

export const openRecordRide: OpenRecordRide = (rideId, record) => {
  router.dismissTo(rideHref({ rideId, focus: record === 'topSpeed' ? 'topSpeed' : null }))
}
