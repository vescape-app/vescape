import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BroadcastIcon,
  CrosshairIcon,
  MegaphoneIcon,
  UserCircleIcon,
  PlusIcon,
  SignOutIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Switch } from '@/components/controls/Switch'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { InputWidget } from '@/components/widgets/InputWidget'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { theme } from '@/constants/theme'
import { NearbyRideBody, RosterList } from '@/modules/group-ride/components/GroupRideRoster'
import {
  ImOkButton,
  RiderSignalPicker,
  useOwnRiderSignal,
} from '@/modules/group-ride/components/RiderSignalPicker'
import {
  riderSignalHue,
  riderSignalKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

type FocusSignal = (point: { latitude: number; longitude: number }) => void

/** `onFocusSignal` fires when a roster row with an active signal is tapped; the host closes the
 *  sheet and focuses the map there. */
export function SocialSheet({ onFocusSignal }: { onFocusSignal?: FocusSignal }) {
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget />
      <GroupRideWidget onFocusSignal={onFocusSignal} />
    </View>
  )
}

function RiderNameWidget() {
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

function GroupRideWidget({ onFocusSignal }: { onFocusSignal?: FocusSignal }) {
  useRenderRateWarning('GroupRideWidget')
  const activeRideId = useGroupRideStore((s) => s.activeRideId)
  const rides = useGroupRideStore((s) => s.rides)
  const nearby = useGroupRideStore((s) => s.nearby)
  const rosterRows = useGroupRideStore((s) => s.rosterRows)
  const connection = useGroupRideStore((s) => s.connection)
  const hasLocation = useGroupRideStore((s) => s.ownLocation !== null)
  const createRide = useGroupRideStore((s) => s.createRide)
  const leaveRide = useGroupRideStore((s) => s.leaveRide)
  const joinRide = useGroupRideStore((s) => s.joinRide)
  const publicRiding = useGroupRideStore((s) => s.publicRiding)
  const setPublicRiding = useGroupRideStore((s) => s.setPublicRiding)
  // Hidden against a relay that does not advertise signals, which would reject them.
  const signalsSupported = useGroupRideStore((s) => s.signalAvailability.supported)

  const [nearbyDismissed, setNearbyDismissed] = useState(false)
  const [pickingSignal, setPickingSignal] = useState(false)

  const activeRide = rides.find((r) => r.id === activeRideId)
  const active = activeRideId != null
  const connected = connection === 'connected'
  // Native gates the relay socket when the installed version is Online/App Blocked and reports it
  // as `blocked`; Group Ride is unusable until the app updates, so replace the live UI entirely.
  const blocked = connection === 'blocked'
  const showNearby = !active && nearby.length > 0 && !nearbyDismissed
  const accent = theme.palette.groupRide.color
  const rideName = activeRide?.name?.trim() || 'Your group ride'
  const picking = active && signalsSupported && pickingSignal

  if (blocked) {
    return (
      <CanvasWidget
        icon={BroadcastIcon}
        title="Group Ride"
        accent={accent}
        surface="secondary"
        height={240}
        footer={
          <Button
            label="Create"
            variant="groupRide"
            icon={PlusIcon}
            onPress={() => {}}
            disabled
            style={styles.fill}
            accessibilityLabel="Create group ride"
          />
        }
      >
        <Placeholder icon={WarningIcon} description="Not available in this version." />
      </CanvasWidget>
    )
  }

  const footer = picking ? (
    <Button
      label="Cancel"
      variant="secondary"
      onPress={() => setPickingSignal(false)}
      style={styles.fill}
      accessibilityLabel="Cancel rider signal"
    />
  ) : active ? (
    <ActiveRideFooter
      signalsSupported={signalsSupported}
      onSignal={() => setPickingSignal(true)}
      onLeave={leaveRide}
    />
  ) : showNearby ? (
    <Button
      label="Join"
      variant="groupRide"
      onPress={() => joinRide(nearby[0].ride.id)}
      disabled={!connected}
      style={styles.fill}
      accessibilityLabel="Join nearest group ride"
    />
  ) : (
    <Button
      label="Create"
      variant="groupRide"
      icon={PlusIcon}
      onPress={() => createRide('')}
      disabled={!hasLocation || !connected}
      style={styles.fill}
      accessibilityLabel="Create group ride"
    />
  )

  const status = active ? (
    <LiveBadge connected={connection === 'connected'} />
  ) : showNearby ? (
    <Pressable
      onPress={() => setNearbyDismissed(true)}
      hitSlop={10}
      accessibilityLabel="Dismiss nearby rides"
    >
      <XIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
    </Pressable>
  ) : null

  const action = (
    <View style={styles.headerActions}>
      {status}
      <Text style={styles.fieldLabel}>Auto</Text>
      <Switch
        value={publicRiding}
        onValueChange={setPublicRiding}
        accent={accent}
        accessibilityLabel="Ride publicly"
      />
    </View>
  )

  return (
    <CanvasWidget
      icon={BroadcastIcon}
      title={active ? rideName : 'Group Ride'}
      accent={accent}
      surface="secondary"
      active={active}
      height={picking || (active && rosterRows.length > 0) ? undefined : 240}
      footer={footer}
      action={action}
    >
      {picking ? (
        <RiderSignalPicker onDone={() => setPickingSignal(false)} />
      ) : active ? (
        rosterRows.length > 0 ? (
          <JoinedRoster rows={rosterRows} onFocusSignal={onFocusSignal} />
        ) : (
          <Placeholder icon={UsersIcon} description="Waiting for other riders to join." />
        )
      ) : publicRiding ? (
        <Placeholder
          icon={BroadcastIcon}
          description="Auto is on. When your board connects, you join the nearest group ride or start one."
        />
      ) : showNearby ? (
        <NearbyRideBody nearby={nearby} />
      ) : !connected ? (
        <Placeholder icon={BroadcastIcon} description="Connecting to server…" />
      ) : !hasLocation ? (
        <Placeholder icon={CrosshairIcon} description="Finding your location…" />
      ) : (
        <Placeholder icon={BroadcastIcon} description="No group rides near you right now." />
      )}
    </CanvasWidget>
  )
}

/** The joined ride's footer: the Rider Signal button (wearing the own active signal), "I'm OK"
 *  while one is active, and a small Leave kept apart so it is hard to hit by accident. */
function ActiveRideFooter({
  signalsSupported,
  onSignal,
  onLeave,
}: {
  signalsSupported: boolean
  onSignal: () => void
  onLeave: () => void
}) {
  const ownSignal = useOwnRiderSignal()
  const ownSignalInfo = ownSignal ? riderSignalKindInfo(ownSignal.kind) : null
  return (
    <View style={styles.activeFooter}>
      {signalsSupported ? (
        <Button
          label={ownSignalInfo ? ownSignalInfo.label : 'Signal'}
          variant="secondary"
          accent={ownSignalInfo ? theme.palette[riderSignalHue(ownSignalInfo)].color : undefined}
          icon={ownSignalInfo ? ownSignalInfo.icon : MegaphoneIcon}
          onPress={onSignal}
          style={styles.fill}
          accessibilityLabel="Rider signal"
        />
      ) : (
        <View style={styles.fill} />
      )}
      {ownSignalInfo ? <ImOkButton size="md" /> : null}
      <Button
        label="Leave"
        variant="destructive"
        size="sm"
        icon={SignOutIcon}
        onPress={onLeave}
        accessibilityLabel="Leave group ride"
      />
    </View>
  )
}

/** The roster with live distances. Own GPS ticks re-render only this, not the whole widget. */
function JoinedRoster({
  rows,
  onFocusSignal,
}: {
  rows: RosterRider[]
  onFocusSignal?: FocusSignal
}) {
  const ownLocation = useGroupRideStore((s) => s.ownLocation)
  return <RosterList rows={rows} ownLocation={ownLocation} onFocusSignal={onFocusSignal} />
}

/** Connection-state pill in the header: green "LIVE" when the relay socket is up, amber
 *  "OFFLINE" when presence can't reach the server (e.g. no internet). */
function LiveBadge({ connected }: { connected: boolean }) {
  const tone = connected ? theme.palette.groupRide : theme.palette.amber
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <View style={[styles.badgeDot, { backgroundColor: tone.color }]} />
      <Text style={[styles.badgeLabel, { color: tone.light }]}>
        {connected ? 'LIVE' : 'OFFLINE'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fill: {
    flex: 1,
  },
  activeFooter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  list: {
    gap: 12,
  },
  riderIdentity: {
    gap: 6,
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
