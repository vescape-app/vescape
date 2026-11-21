import { StyleSheet } from 'react-native'
import { dismissRideNotice } from 'vescape-core'

import { theme } from '@/constants/theme'
import { PinKindBadge } from '@/modules/group-ride/components/PinKindBadge'
import {
  type PinKindInfo,
  riderSignalKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { riderSignalNoticeRider } from '@/modules/group-ride/lib/riderSignalNotice'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import {
  RideNoticeCard,
  type RideNoticeLook,
} from '@/modules/ride-notices/components/RideNoticeCard'
import { useRideNoticesStore } from '@/modules/ride-notices/store/rideNoticesStore'

interface RideNoticeOverlayProps {
  top: number
  ownLocation: { latitude: number; longitude: number } | null
  onShowOnMap: (location: { latitude: number; longitude: number }) => void
}

export function RideNoticeOverlay({ top, ownLocation, onShowOnMap }: RideNoticeOverlayProps) {
  const notices = useRideNoticesStore((s) => s.notices)
  const pins = useGroupRideStore((s) => s.publicPins)
  const notice = notices[0]
  if (!notice) return null

  return (
    <RideNoticeCard
      notice={notice}
      moreCount={notices.length - 1}
      ownLocation={ownLocation}
      onDismiss={dismissRideNotice}
      onShowOnMap={onShowOnMap}
      look={signalLook(notice.key, pins)}
      style={[styles.position, { top }]}
    />
  )
}

function signalLook(
  key: string,
  pins: Parameters<typeof riderSignalNoticeRider>[1],
): RideNoticeLook | null {
  const rider = riderSignalNoticeRider(key, pins)
  const info = rider?.signal ? riderSignalKindInfo(rider.signal.kind) : null
  return rider && info ? riderSignalNoticeLook(info, rider.nick) : null
}

export function riderSignalNoticeLook(info: PinKindInfo, nick: string): RideNoticeLook {
  const hue = theme.palette[info.hue]
  return {
    icon: <PinKindBadge info={info} color={hue.color} size={36} strokeWidth={2} />,
    tone: { color: hue.color, text: hue.text },
    title: info.label,
    subject: nick || 'Rider',
  }
}

const styles = StyleSheet.create({
  position: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
  },
})
