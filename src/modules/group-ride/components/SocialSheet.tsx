import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowLeftIcon, MapPinIcon, SignInIcon, WarningIcon } from 'phosphor-react-native'
import type { PublicRideStatus, RiderProfile } from 'vescape-core'
import { Text } from '@/components/base/Text'
import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { publicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { theme } from '@/constants/theme'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import { RiderNickForm } from '@/modules/profile/components/RiderNickForm'
import { FriendsCard } from '@/modules/profile/components/FriendsCard'
import { AccountPill } from '@/modules/profile/components/AccountPill'
import { RiderProfileCard } from '@/modules/profile/components/RiderProfileCard'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { FriendRides } from '@/modules/group-ride/components/FriendRides'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'
import { RosterList } from '@/modules/group-ride/components/GroupRideRoster'
import { NEARBY_RIDER_LIMIT } from '@/modules/group-ride/lib/roster'

/** `onNavigate` fires before the sheet routes away (sign-in), so the host can close it. */
export function SocialSheet({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const profileRider = useGroupRideStore((s) => s.profileRider)
  const openRiderProfile = useGroupRideStore((s) => s.openRiderProfile)
  if (profileRider) return <RiderProfilePage rider={profileRider} onNavigate={onNavigate} />
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget onNavigate={onNavigate} />
      <PublicRideWidget onNavigate={onNavigate} />
      <FriendsCard
        onPressRider={openRiderProfile}
        onSignIn={() => {
          onNavigate?.()
          router.push(routes.signIn)
        }}
      />
      <NearbyRidersWidget />
    </View>
  )
}

/** One rider inside the drawer, opened from a list or a map pin; back returns to Social. */
function RiderProfilePage({ rider, onNavigate }: { rider: RiderProfile; onNavigate?: () => void }) {
  const closeRiderProfile = useGroupRideStore((s) => s.closeRiderProfile)
  const focusRider = useGroupRideStore((s) => s.focusRider)
  const onMap = useGroupRideStore((s) =>
    s.rosterRows.some((row) => row.id === rider.accountId && row.presence),
  )
  const isFriend = useFriendsStore((s) =>
    s.lists.friends.some((row) => row.accountId === rider.accountId),
  )
  return (
    <View testID="social-rider-profile" style={styles.list}>
      <Button
        label="Social"
        icon={ArrowLeftIcon}
        size="sm"
        variant="secondary"
        style={styles.back}
        onPress={closeRiderProfile}
        accessibilityLabel="Back to Social"
      />
      <View style={styles.card}>
        <RiderProfileCard rider={rider}>
          {onMap ? (
            <Button
              label="Show on map"
              icon={MapPinIcon}
              size="sm"
              variant="groupRide"
              style={styles.back}
              onPress={() => {
                focusRider(rider.accountId)
                closeRiderProfile()
                onNavigate?.()
              }}
            />
          ) : null}
          {isFriend ? (
            <FriendRides accountId={rider.accountId} onOpen={() => onNavigate?.()} />
          ) : null}
        </RiderProfileCard>
      </View>
    </View>
  )
}

/** Who the rider is, as the Account pill; a signed-in rider without a nick picks one first. */
function RiderNameWidget({ onNavigate }: { onNavigate?: () => void }) {
  const profileLoaded = useRiderProfileStore((s) => s.loaded)
  const nick = useRiderProfileStore((s) => s.profile?.nick ?? null)
  const error = useRiderProfileStore((s) => s.error)

  if (profileLoaded && nick == null) return <RiderNickForm title="Pick a nick to ride under" />
  return (
    <>
      <AccountPill onNavigate={onNavigate} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </>
  )
}

/** Why the switch turned itself off, for the rider. */
const ENDED: Record<NonNullable<PublicRideStatus['reason']>, string> = {
  replaced: 'Turned off: you went public on another phone.',
  'end-time': 'Your public ride time is up.',
  'away-expired': 'You were offline too long. Back on when you reconnect.',
  'signed-out': 'Turned off: you signed out.',
  refused: 'The server turned it off. Check your nick and sign-in.',
}

/** The public ride switch. Native owns it; this only shows it and sends the rider's choice. */
function PublicRideWidget({ onNavigate }: { onNavigate?: () => void }) {
  useRenderRateWarning('PublicRideWidget')
  const router = useRouter()
  const connection = useGroupRideStore((s) => s.connection)
  const status = useGroupRideStore((s) => s.publicRide)
  const setPublicRide = useGroupRideStore((s) => s.setPublicRide)
  const signedIn = useDeviceAccountReady()
  const hasNick = useRiderProfileStore((s) => s.profile?.nick != null)
  const nowMs = useMinuteNow()

  // Native gates the relay socket when the installed version is Online/App Blocked and reports it
  // as `blocked`; the public ride is unusable until the app updates.
  if (connection === 'blocked') {
    return (
      <View style={styles.card}>
        <Placeholder icon={WarningIcon} description="Not available in this version." />
      </View>
    )
  }

  const ready = signedIn && hasNick && status.supported
  const hint = !signedIn
    ? null
    : !hasNick
      ? 'Pick a nick above to ride public.'
      : !status.supported
        ? connection === 'connected'
          ? 'Public ride is not available on the server yet.'
          : 'Connecting to server…'
        : !status.on && status.reason
          ? ENDED[status.reason]
          : null

  return (
    <View style={styles.card}>
      {/* What still blocks the switch reads first, before the greyed-out selector. */}
      {hint && !ready ? <Text style={styles.hint}>{hint}</Text> : null}
      <PublicRideSelector
        value={publicRideChoice(status, nowMs)}
        live={status.live}
        disabled={!ready}
        onValueChange={setPublicRide}
      />
      {ready && status.on && !status.live ? (
        <Banner
          variant="warning"
          title="Not visible yet"
          message="Connect your board to go public."
        />
      ) : null}
      <Text style={styles.notice}>
        Your ride is stored on the server and may appear on vescape.app when you ride with others.
      </Text>
      {hint && ready ? <Text style={styles.hint}>{hint}</Text> : null}
      {signedIn ? null : (
        <Button
          label="Sign in to ride public"
          variant="groupRide"
          icon={SignInIcon}
          onPress={() => {
            onNavigate?.()
            router.push(routes.signIn)
          }}
          accessibilityLabel="Sign in to ride public"
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  nearbyTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  notice: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  hint: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    gap: 12,
  },
  back: {
    alignSelf: 'flex-start',
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})

/** The public riders around the phone, nearest first; tapping one opens their profile. Shown
 *  with the switch off too: look-around runs from the last known position. */
function NearbyRidersWidget() {
  const rows = useGroupRideStore((s) => s.rosterRows)
  const ownLocation = useGroupRideStore((s) => s.ownLocation)
  const openRiderProfile = useGroupRideStore((s) => s.openRiderProfile)
  return (
    <View style={styles.card} testID="nearby-riders">
      <Text style={styles.nearbyTitle}>Riders nearby</Text>
      {rows.length ? (
        <RosterList
          rows={rows}
          ownLocation={ownLocation}
          onPressRider={(rider) =>
            openRiderProfile({ accountId: rider.id, nick: rider.name, nationality: null })
          }
        />
      ) : (
        <Text style={styles.notice}>No riders nearby right now.</Text>
      )}
      {rows.length >= NEARBY_RIDER_LIMIT ? (
        <Text style={styles.notice}>Showing the nearest {NEARBY_RIDER_LIMIT}.</Text>
      ) : null}
    </View>
  )
}
