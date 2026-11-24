import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CaretRightIcon, UserCircleGearIcon, WarningIcon } from 'phosphor-react-native'
import type { PublicRideStatus } from 'vescape-core'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Placeholder } from '@/components/base/Placeholder'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import {
  publicRideChoice,
  publicRideEndLabel,
  publicRidePresetEnds,
  publicRideTimeLeft,
} from '@/modules/group-ride/lib/publicRide'
import { theme } from '@/constants/theme'
import { PublicRideManualAction } from '@/modules/group-ride/components/PublicRideManualAction'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import { AccountPill } from '@/modules/profile/components/AccountPill'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'
import { SocialRiderPanel, type SocialRiderPanelProps } from './SocialRiderPanel'

export function SocialSheet(props: SocialRiderPanelProps) {
  return (
    <View testID="social-sheet" style={styles.list}>
      <PublicRideWidget onNavigate={props.onNavigate} />
      <SocialRiderPanel {...props} />
    </View>
  )
}

const ENDED: Record<NonNullable<PublicRideStatus['reason']>, string> = {
  replaced: 'Turned off: you went public on another phone.',
  'end-time': 'Your public ride time is up.',
  'away-expired': 'You were offline too long. Back on when you reconnect.',
  'signed-out': 'Turned off: you signed out.',
  refused: 'The server turned it off. Check your nick and sign-in.',
}

function PublicRideWidget({ onNavigate }: { onNavigate?: () => void }) {
  useRenderRateWarning('PublicRideWidget')
  const router = useRouter()
  const connection = useGroupRideStore((s) => s.connection)
  const status = useGroupRideStore((s) => s.publicRide)
  const boardConnected = useBleStore((s) => s.status === 'connected')
  const setPublicRide = useGroupRideStore((s) => s.setPublicRide)
  const setManualSharing = useGroupRideStore((s) => s.setManualPublicRideSharing)
  const signedIn = useDeviceAccountReady()
  const hasNick = useRiderProfileStore((s) => s.profile?.nick != null)
  const profileLoaded = useRiderProfileStore((s) => s.loaded)
  const settings = signedIn ? (
    <IconButton
      icon={UserCircleGearIcon}
      size="sm"
      accessibilityLabel="Open Privacy Zones"
      onPress={() => {
        onNavigate?.()
        router.push(routes.settingsPrivacyZones)
      }}
    />
  ) : null
  const statusAt = useGroupRideStore((s) => s.publicRideAt)
  const nowMs = Math.max(useMinuteNow(true, status.until), statusAt)
  const { timeFormat, dateFormat } = useUserPreferences()
  const presetEnds = useMemo(
    () => publicRidePresetEnds(nowMs, timeFormat, dateFormat),
    [dateFormat, nowMs, timeFormat],
  )

  if (connection === 'blocked') {
    return (
      <View style={styles.card}>
        <View style={styles.blockedAction}>
          {settings ?? <AccountPill onNavigate={onNavigate} />}
        </View>
        <Placeholder compact icon={WarningIcon} description="Not available in this version." />
      </View>
    )
  }

  const needsNick = signedIn && profileLoaded && !hasNick
  const setupAction = !signedIn ? (
    <AccountPill signInSize="lg" onNavigate={onNavigate} />
  ) : needsNick ? (
    <Button
      label="Set a nick to ride public"
      size="lg"
      variant="success"
      icon={CaretRightIcon}
      iconPosition="right"
      onPress={() => {
        onNavigate?.()
        router.push(routes.account)
      }}
    />
  ) : null
  const ready = signedIn && hasNick && status.supported
  const hint = !signedIn
    ? null
    : !hasNick
      ? !profileLoaded
        ? 'Loading your rider profile…'
        : null
      : !status.supported
        ? connection === 'connected'
          ? 'Public ride is not available on the server yet.'
          : 'Connecting to server…'
        : status.activation === 'off' && status.reason
          ? ENDED[status.reason]
          : null

  const choice = publicRideChoice(status, nowMs)
  const timeLeft =
    ready && status.activation !== 'off' ? publicRideTimeLeft(status.until, nowMs) : null
  const running =
    timeLeft && status.until != null && choice.mode === 'hours'
      ? {
          hours: choice.hours,
          left: timeLeft,
          end: publicRideEndLabel(status.until, nowMs, timeFormat, dateFormat),
        }
      : null

  return (
    <View style={styles.publicRide}>
      <PublicRideSelector
        value={choice}
        running={running}
        presetEnds={presetEnds}
        activation={status.activation}
        live={status.live}
        boardConnected={boardConnected}
        notice={hint}
        headerAction={settings}
        overlayAction={setupAction}
        disabled={!ready}
        onValueChange={setPublicRide}
      />
      {ready && (status.activation === 'waiting' || status.activation === 'phone') ? (
        <PublicRideManualAction activation={status.activation} onChange={setManualSharing} />
      ) : null}
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
  publicRide: { gap: 10 },
  blockedAction: { alignSelf: 'flex-end' },
  list: {
    gap: 12,
  },
})
