import { StyleSheet } from 'react-native'
import { dismissRideNotice } from 'vescape-core'

import { RideNoticeCard } from '@/modules/ride-notices/components/RideNoticeCard'
import { useRideNoticesStore } from '@/modules/ride-notices/store/rideNoticesStore'

interface RideNoticeOverlayProps {
  top: number
  ownLocation: { latitude: number; longitude: number } | null
  onShowOnMap: (location: { latitude: number; longitude: number }) => void
}

/** The most urgent Ride Notice, floating under the top bar. */
export function RideNoticeOverlay({ top, ownLocation, onShowOnMap }: RideNoticeOverlayProps) {
  const notices = useRideNoticesStore((s) => s.notices)
  const notice = notices[0]
  if (!notice) return null

  return (
    <RideNoticeCard
      notice={notice}
      moreCount={notices.length - 1}
      ownLocation={ownLocation}
      onDismiss={dismissRideNotice}
      onShowOnMap={onShowOnMap}
      style={[styles.position, { top }]}
    />
  )
}

const styles = StyleSheet.create({
  position: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
  },
})
