import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BroadcastIcon,
  CrosshairIcon,
  PaletteIcon,
  PlusIcon,
  SignOutIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { ColorPicker } from '@/components/forms/ColorPicker'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { InputWidget } from '@/components/widgets/InputWidget'
import { riderColorOptions } from '@/modules/group-ride/constants/riderColors'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { theme } from '@/constants/theme'
import { NearbyRideBody, RosterGrid } from '@/modules/group-ride/components/GroupRideRoster'

export function SocialSheet() {
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget />
      <GroupRideWidget />
    </View>
  )
}

function RiderNameWidget() {
  const riderName = useRiderStore((s) => s.riderName)
  const setName = useRiderStore((s) => s.setName)
  const riderColor = useRiderStore((s) => s.riderColor)
  const setColor = useRiderStore((s) => s.setColor)

  return (
    <InputWidget
      label="Your name"
      value={riderName}
      placeholder="Add a display name"
      maxLength={32}
      onCommit={(value) => void setName(value)}
      accessibilityLabel="Rider display name"
      commitOnBlur={false}
      leading={
        <View
          style={[
            styles.colorDot,
            riderColor ? { backgroundColor: riderColor } : styles.colorDotEmpty,
          ]}
          accessibilityLabel={riderColor ? `Your color ${riderColor}` : 'No color selected'}
        >
          {riderColor ? null : (
            <PaletteIcon size={14} color={theme.neutral.textSecondary} weight="duotone" />
          )}
        </View>
      }
      editingContent={
        <View style={styles.colorEditor}>
          <Text style={styles.colorLabel}>Color</Text>
          <ColorPicker
            value={riderColor}
            colors={riderColorOptions}
            onChange={(color) => void setColor(color)}
          />
        </View>
      }
    />
  )
}

function GroupRideWidget() {
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

  const [nearbyDismissed, setNearbyDismissed] = useState(false)

  const activeRide = rides.find((r) => r.id === activeRideId)
  const active = activeRideId != null
  const connected = connection === 'connected'
  // Native gates the relay socket when the installed version is Online/App Blocked and reports it
  // as `blocked`; Group Ride is unusable until the app updates, so replace the live UI entirely.
  const blocked = connection === 'blocked'
  const showNearby = !active && nearby.length > 0 && !nearbyDismissed
  const accent = theme.palette.groupRide.color
  const rideName = activeRide?.name?.trim() || 'Your group ride'

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

  const footer = active ? (
    <Button
      label="Leave"
      variant="destructive"
      icon={SignOutIcon}
      onPress={leaveRide}
      style={styles.fill}
      accessibilityLabel="Leave group ride"
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

  const action = active ? (
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

  return (
    <CanvasWidget
      icon={BroadcastIcon}
      title={active ? rideName : 'Group Ride'}
      accent={accent}
      surface="secondary"
      active={active}
      height={active && rosterRows.length > 0 ? undefined : 240}
      footer={footer}
      action={action}
    >
      {active ? (
        rosterRows.length > 0 ? (
          <RosterGrid rows={rosterRows} accent={accent} connected={connection === 'connected'} />
        ) : (
          <Placeholder icon={UsersIcon} description="Waiting for other riders to join." />
        )
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
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.neutral.border,
  },
  colorDotEmpty: {
    backgroundColor: theme.neutral.surfaceDeep,
  },
  colorEditor: {
    marginLeft: 36,
    gap: 8,
  },
  colorLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fill: {
    flex: 1,
  },
  list: {
    gap: 12,
  },
})
