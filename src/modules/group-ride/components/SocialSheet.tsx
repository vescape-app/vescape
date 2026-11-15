import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SignInIcon, UserCircleIcon, WarningIcon } from 'phosphor-react-native'
import type { PublicRideStatus } from 'vescape-core'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { InputWidget } from '@/components/widgets/InputWidget'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { publicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { theme } from '@/constants/theme'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import { RiderNickForm } from '@/modules/profile/components/RiderNickForm'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'

/** `onNavigate` fires before the sheet routes away (sign-in), so the host can close it. */
export function SocialSheet({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget />
      <PublicRideWidget onNavigate={onNavigate} />
    </View>
  )
}

/** Signed-in riders ride under their Rider Profile nick; signed-out riders keep the local name. */
function RiderNameWidget() {
  const profileLoaded = useRiderProfileStore((s) => s.loaded)
  const nick = useRiderProfileStore((s) => s.profile?.nick ?? null)
  const riderColor = useSelectedBoardRailColor()

  if (!profileLoaded) return <LocalRiderNameWidget />
  if (nick == null) return <RiderNickForm title="Pick a nick to ride under" />
  return (
    <View style={styles.nickRow}>
      <UserCircleIcon
        size={24}
        color={riderColor ?? theme.neutral.textSecondary}
        weight="duotone"
      />
      <Text style={styles.nick}>{nick}</Text>
    </View>
  )
}

function LocalRiderNameWidget() {
  const riderName = useRiderStore((s) => s.riderName)
  const setName = useRiderStore((s) => s.setName)
  const error = useRiderStore((s) => s.error)
  const riderColor = useSelectedBoardRailColor()

  return (
    <View style={styles.riderIdentity}>
      <InputWidget
        label="Your name"
        value={riderName}
        placeholder="Add a display name"
        maxLength={32}
        onCommit={(value) => {
          // intentional-suppression: Rider store error is rendered by Social Sheet
          void setName(value).catch(() => undefined) // The store exposes this failure below.
        }}
        accessibilityLabel="Rider display name"
        leading={
          <UserCircleIcon
            size={24}
            color={riderColor ?? theme.neutral.textSecondary}
            weight="duotone"
          />
        }
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
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
        : status.on && !status.live
          ? 'You go public when your board connects.'
          : !status.on && status.reason
            ? ENDED[status.reason]
            : null

  return (
    <View style={styles.card}>
      <PublicRideSelector
        value={publicRideChoice(status, nowMs)}
        live={status.live}
        disabled={!ready}
        onValueChange={setPublicRide}
      />
      <Text style={styles.notice}>
        Your ride is stored on the server and may appear on vescape.app when you ride with others.
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
  nickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  nick: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  riderIdentity: {
    gap: 6,
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
