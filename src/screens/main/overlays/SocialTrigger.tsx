import { useEffect, useRef, useState } from 'react'
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
import { PulsingBroadcastIcon } from '@/modules/group-ride/components/BroadcastGlyph'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'

/**
 * The top bar's Social button and its drawer. In a ride it grows the Rider Signal button below it,
 * the way History grows today's stats; every signal action lives behind that one, and the Social
 * drawer only shows the ride.
 */
export function SocialTrigger() {
  const triggerRef = useRef<View>(null)
  const [socialOpen, setSocialOpen] = useState(false)
  const [signalOpen, setSignalOpen] = useState(false)
  const friendRiding = useFriendsStore((s) => s.friendRiding)
  // A rider tapped on the map opens the drawer on their profile.
  const profileOpen = useGroupRideStore((s) => s.profileRider !== null)
  useEffect(() => {
    if (profileOpen) setSocialOpen(true)
  }, [profileOpen])
  // Seeing Social is seeing who started riding.
  useEffect(() => {
    if (socialOpen) useFriendsStore.getState().acknowledgeRiding()
  }, [socialOpen, friendRiding])
  // Switched on wears the broadcast icon; it lights up only once positions actually go out.
  const sharingOn = useGroupRideStore((s) => s.publicRide.on)
  const rideActive = useGroupRideStore((s) => s.publicRide.live)
  // Native judges it: in a ride on a relay with signals, or public. Hidden otherwise.
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
          // The Rider's own live signal blinks until they clear it, so a forgotten one gets noticed.
          blink={ownSignal !== null}
          testID="rider-signal-trigger"
          accessibilityLabel="Rider signal"
          extension={
            signalsSupported ? (
              <OwnSignalIcon
                size={20}
                color={ownSignal?.accent ?? theme.control.icon}
                weight="bold"
              />
            ) : null
          }
        >
          <IconButton
            icon={rideActive ? PulsingBroadcastIcon : sharingOn ? BroadcastIcon : UsersThreeIcon}
            onPress={() => setSocialOpen(true)}
            accessibilityLabel="Social"
            testID="social-drawer-trigger"
            dot={friendRiding ? theme.palette.green.color : undefined}
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
        keyboardShouldPersistTaps="handled"
        onClose={() => {
          setSocialOpen(false)
          useGroupRideStore.getState().closeRiderProfile()
        }}
      >
        <SocialSheet
          onNavigate={() => {
            setSocialOpen(false)
            useGroupRideStore.getState().closeRiderProfile()
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
