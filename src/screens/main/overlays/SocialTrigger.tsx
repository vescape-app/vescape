import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { BroadcastIcon, MegaphoneIcon, UsersThreeIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import {
  IconButtonExtension,
  IconButtonExtensionStat,
} from '@/components/controls/IconButtonExtension'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { interaction, theme } from '@/constants/theme'
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
  useEffect(() => {
    if (socialOpen) useFriendsStore.getState().acknowledgeRiding()
  }, [socialOpen, friendRiding])
  const sharingOn = useGroupRideStore((s) => s.publicRide.activation !== 'off')
  const rideActive = useGroupRideStore((s) => s.publicRide.live)
  const requestColor = useColoredActionForeground(theme.palette.blue.color)
  const requestLabel = `${incomingRequests} friend ${incomingRequests === 1 ? 'request' : 'requests'}`

  function openSocial() {
    setView({
      ...INITIAL_SOCIAL_VIEW,
      tab: incomingRequests > 0 || friendRiding ? 'friends' : 'nearby',
    })
    setSocialOpen(true)
  }
  const signalsSupported = useGroupRideStore((s) => s.signalAvailability.supported)
  const othersSignal = useOthersSignalTakeover()
  const ownSignal = useOwnSignalTakeover()
  const OwnSignalIcon = ownSignal?.icon ?? MegaphoneIcon
  const showRequests = incomingRequests > 0

  return (
    <>
      <View ref={triggerRef} collapsable={false} style={styles.trigger}>
        <IconButtonExtension
          direction="down"
          blink={!showRequests && ownSignal !== null}
          extension={
            showRequests || signalsSupported ? (
              <>
                {signalsSupported ? (
                  <Pressable
                    testID="rider-signal-trigger"
                    accessibilityLabel="Rider signal"
                    onPress={() => setSignalOpen(true)}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <OwnSignalIcon
                      size={20}
                      color={ownSignal?.accent ?? theme.control.icon}
                      weight="bold"
                    />
                  </Pressable>
                ) : null}
                {showRequests ? (
                  <Pressable
                    testID="social-friend-requests"
                    accessibilityLabel={requestLabel}
                    onPress={openSocial}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <IconButtonExtensionStat
                      value={String(incomingRequests)}
                      color={requestColor}
                    />
                  </Pressable>
                ) : null}
              </>
            ) : null
          }
        >
          <IconButton
            icon={rideActive ? PulsingBroadcastIcon : sharingOn ? BroadcastIcon : UsersThreeIcon}
            onPress={openSocial}
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
  pressed: { opacity: interaction.pressedOpacity },
  trigger: {
    position: 'absolute',
    top: 0,
    left: 10,
  },
})
