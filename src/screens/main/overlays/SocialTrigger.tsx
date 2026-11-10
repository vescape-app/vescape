import { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { BroadcastIcon, MegaphoneIcon, UsersThreeIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { IconButtonExtension } from '@/components/controls/IconButtonExtension'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import {
  RiderSignalPicker,
  useOthersSignalTakeover,
  useOwnSignalTakeover,
} from '@/modules/group-ride/components/RiderSignalPicker'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

interface SocialTriggerProps {
  onFocusCoordinate: (coordinate: { latitude: number; longitude: number }) => void
}

/**
 * The top bar's Social button and its drawer. In a ride it grows the Rider Signal button below it,
 * the way History grows today's stats; every signal action lives behind that one, and the Social
 * drawer only shows the ride.
 */
export function SocialTrigger({ onFocusCoordinate }: SocialTriggerProps) {
  const triggerRef = useRef<View>(null)
  const [socialOpen, setSocialOpen] = useState(false)
  const [signalOpen, setSignalOpen] = useState(false)
  const nearbyBadge = useGroupRideStore((s) => s.badge)
  const rideActive = useGroupRideStore((s) => s.activeRideId !== null)
  // Hidden against a relay that does not advertise signals, which would reject them.
  const signalsSupported = useGroupRideStore((s) => s.signalAvailability.supported)
  // Two places so the two never blur: Social wears a signal another Rider needs help with, the
  // Rider Signal button wears the one this Rider sent, each until cleared or expired.
  const othersSignal = useOthersSignalTakeover()
  const ownSignal = useOwnSignalTakeover()
  const OwnSignalIcon = ownSignal?.icon ?? MegaphoneIcon

  return (
    <>
      <View ref={triggerRef} collapsable={false} style={styles.trigger}>
        <IconButtonExtension
          direction="down"
          onPress={() => setSignalOpen(true)}
          testID="rider-signal-trigger"
          accessibilityLabel="Rider signal"
          extension={
            rideActive && signalsSupported ? (
              <OwnSignalIcon
                size={20}
                color={ownSignal?.accent ?? theme.control.icon}
                weight="bold"
              />
            ) : null
          }
        >
          <IconButton
            icon={rideActive ? BroadcastIcon : UsersThreeIcon}
            onPress={() => setSocialOpen(true)}
            accessibilityLabel="Social"
            testID="social-drawer-trigger"
            dot={nearbyBadge && !rideActive ? theme.palette.groupRide.color : undefined}
            accent={rideActive ? theme.palette.groupRide.color : undefined}
            takeover={othersSignal}
          />
        </IconButtonExtension>
      </View>
      <EdgeDrawer
        visible={socialOpen}
        triggerRef={triggerRef}
        edge="top"
        title="Social"
        icon={UsersThreeIcon}
        backdropTestID="social-drawer-backdrop"
        onClose={() => setSocialOpen(false)}
      >
        <SocialSheet
          onFocusSignal={(point) => {
            setSocialOpen(false)
            onFocusCoordinate(point)
          }}
        />
      </EdgeDrawer>
      <EdgeDrawer
        visible={signalOpen}
        triggerRef={triggerRef}
        edge="top"
        title="Rider signal"
        icon={MegaphoneIcon}
        onClose={() => setSignalOpen(false)}
      >
        <RiderSignalPicker onDone={() => setSignalOpen(false)} />
      </EdgeDrawer>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    position: 'absolute',
    top: 0,
    left: 10,
  },
})
