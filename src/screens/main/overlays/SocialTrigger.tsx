import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { BroadcastIcon, MegaphoneIcon, UsersThreeIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import {
  IconButtonExtension,
  IconButtonExtensionStat,
} from '@/components/controls/IconButtonExtension'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { useColoredActionForeground } from '@/hooks/useTheme'
import {
  RiderSignalPicker,
  useOthersSignalTakeover,
  useOwnSignalTakeover,
} from '@/modules/group-ride/components/RiderSignalPicker'
import { PulsingBroadcastIcon } from '@/modules/group-ride/components/BroadcastGlyph'
import {
  INITIAL_SOCIAL_VIEW,
  type SocialView,
} from '@/modules/group-ride/components/SocialRiderPanel'
import { riderProfileHref } from '@/navigation/links'
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
  const incomingRequests = useFriendsStore((s) => s.lists.incoming.length)
  const [view, setView] = useState<SocialView>(INITIAL_SOCIAL_VIEW)
  const pendingProfile = useRef<string | null>(null)

  const onSocialClose = useCallback(() => {
    setSocialOpen(false)
    const accountId = pendingProfile.current
    pendingProfile.current = null
    setView(INITIAL_SOCIAL_VIEW)
    if (accountId) router.push(riderProfileHref(accountId))
  }, [])
  // Seeing Social is seeing who started riding.
  useEffect(() => {
    if (socialOpen) useFriendsStore.getState().acknowledgeRiding()
  }, [socialOpen, friendRiding])
  // Switched on wears the broadcast icon; it lights up only once positions actually go out.
  const sharingOn = useGroupRideStore((s) => s.publicRide.activation !== 'off')
  const rideActive = useGroupRideStore((s) => s.publicRide.live)
  const requestColor = useColoredActionForeground(theme.palette.blue.color)
  const requestLabel = `${incomingRequests} friend ${incomingRequests === 1 ? 'request' : 'requests'}`

  function openExtension() {
    if (showRequests) {
      setView({ ...INITIAL_SOCIAL_VIEW, tab: 'friends' })
      setSocialOpen(true)
    } else {
      setSignalOpen(true)
    }
  }
  // Native judges it: in a ride on a relay with signals, or public. Hidden otherwise.
  const signalsSupported = useGroupRideStore((s) => s.signalAvailability.supported)
  // Two places so the two never blur: Social wears a signal another Rider needs help with, the
  // Rider Signal button wears the one this Rider sent, each until cleared or expired.
  const othersSignal = useOthersSignalTakeover()
  const ownSignal = useOwnSignalTakeover()
  const OwnSignalIcon = ownSignal?.icon ?? MegaphoneIcon
  // Requests borrow the extension only while it has no signal to show, so a live own signal stays
  // reachable through a relay reconnect.
  const showRequests = incomingRequests > 0 && !rideActive && ownSignal === null

  return (
    <>
      <View ref={triggerRef} collapsable={false} style={styles.trigger}>
        <IconButtonExtension
          direction="down"
          onPress={openExtension}
          // The Rider's own live signal blinks until they clear it, so a forgotten one gets noticed.
          blink={!showRequests && ownSignal !== null}
          testID={showRequests ? 'social-friend-requests' : 'rider-signal-trigger'}
          accessibilityLabel={showRequests ? requestLabel : 'Rider signal'}
          extension={
            showRequests ? (
              <IconButtonExtensionStat value={String(incomingRequests)} color={requestColor} />
            ) : signalsSupported ? (
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
            accessibilityLabel={incomingRequests > 0 ? `Social, ${requestLabel}` : 'Social'}
            testID="social-drawer-trigger"
            dot={
              incomingRequests > 0
                ? requestColor
                : friendRiding
                  ? theme.palette.green.color
                  : undefined
            }
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
        onClose={onSocialClose}
      >
        <SocialSheet
          view={view}
          onViewChange={setView}
          onOpenProfile={(accountId) => {
            pendingProfile.current = accountId
            setSocialOpen(false)
          }}
          onNavigate={() => setSocialOpen(false)}
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
