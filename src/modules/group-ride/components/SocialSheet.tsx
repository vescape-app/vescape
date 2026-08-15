import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BroadcastIcon,
  ChartLineUpIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  GaugeIcon,
  BatteryMediumIcon,
  PaletteIcon,
  PlusIcon,
  SignOutIcon,
  ThermometerSimpleIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from 'phosphor-react-native'
import { router } from 'expo-router'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { ColorPicker } from '@/components/forms/ColorPicker'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { InputWidget } from '@/components/widgets/InputWidget'
import { LinkWidget } from '@/components/widgets/LinkWidget'
import { riderColorOptions } from '@/modules/group-ride/constants/riderColors'
import {
  batteryLevel,
  type TelemetryLevel,
  TELEMETRY_LEVEL_COLOR,
  tempLevel,
} from '@/modules/board/constants/telemetryThresholds'
import { DASH, fmtDistance, fmtPercent, fmtSpeedKmh, fmtTempC } from '@/helpers/format'
import type { NearbyRide } from '@/modules/group-ride/lib/nearby'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { routes } from '@/navigation/routes'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { theme } from '@/constants/theme'

interface SocialSheetProps {
  /** Called before navigating away so the host can dismiss the sheet. */
  onNavigate: () => void
}

export function SocialSheet({ onNavigate }: SocialSheetProps) {
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget />
      <GroupRideWidget />
      <LinkWidget
        icon={ChartLineUpIcon}
        accent={theme.palette.sky.color}
        label="Profile stats"
        hint="All-time & monthly riding totals"
        onPress={() => {
          onNavigate()
          router.push(routes.profileStats)
        }}
      />
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
        height={240}
        footer={
          <Button
            label="Create"
            icon={PlusIcon}
            onPress={() => {}}
            disabled
            style={[styles.fill, styles.actionBtn]}
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
      onPress={() => joinRide(nearby[0].ride.id)}
      disabled={!connected}
      style={[styles.fill, styles.actionBtn]}
      accessibilityLabel="Join nearest group ride"
    />
  ) : (
    <Button
      label="Create"
      icon={PlusIcon}
      onPress={() => createRide('')}
      disabled={!hasLocation || !connected}
      style={[styles.fill, styles.actionBtn]}
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

/** Three-column roster of the riders in the active ride. */
function RosterGrid({
  rows,
  accent,
  connected,
}: {
  rows: RosterRider[]
  accent: string
  connected: boolean
}) {
  return (
    <View style={styles.grid}>
      {rows.map((rider) => (
        <RiderCell key={rider.id} rider={rider} accent={accent} connected={connected} />
      ))}
    </View>
  )
}

interface RiderStat {
  value?: string
  level: TelemetryLevel
}

interface RiderStats {
  speed: RiderStat
  soc: RiderStat
  motor: RiderStat
  ctrl: RiderStat
  phone: RiderStat
}

const NORMAL_STAT: RiderStat = { level: 'normal' }

/** Per-Rider telemetry values for the roster stat grid, each carrying its alert level. */
function riderStats(p: RosterRider['presence']): RiderStats {
  if (!p)
    return {
      speed: NORMAL_STAT,
      soc: NORMAL_STAT,
      motor: NORMAL_STAT,
      ctrl: NORMAL_STAT,
      phone: NORMAL_STAT,
    }
  return {
    speed: {
      value: p.speed != null ? fmtSpeedKmh(p.speed) : undefined,
      level: 'normal',
    },
    soc: {
      value: p.soc != null ? fmtPercent(p.soc) : undefined,
      level: batteryLevel(p.soc),
    },
    motor: {
      value: p.motorTemp != null ? `M ${fmtTempC(p.motorTemp)}` : undefined,
      level: tempLevel(p.motorTemp),
    },
    ctrl: {
      value: p.ctrlTemp != null ? `C ${fmtTempC(p.ctrlTemp)}` : undefined,
      level: tempLevel(p.ctrlTemp),
    },
    phone: {
      value: p.phoneBattery != null ? fmtPercent(p.phoneBattery) : undefined,
      level: 'normal',
    },
  }
}

/** One fixed column of the stat grid: its icon is always shown; a missing value reads as a dash.
 *  When `level` is warning/critical the icon and value adopt the matching alert color. */
function StatCell({
  icon: StatIcon,
  value,
  level = 'normal',
}: {
  icon: Icon
  value?: string
  level?: TelemetryLevel
}) {
  const alert = level !== 'normal'
  const color = alert ? TELEMETRY_LEVEL_COLOR[level] : theme.neutral.textSecondary
  return (
    <View style={styles.statCell}>
      <View style={styles.statIconSlot}>
        <StatIcon size={11} color={color} weight="bold" />
      </View>
      <Text style={[styles.statValue, alert && { color }]} numberOfLines={1}>
        {value ?? DASH}
      </Text>
    </View>
  )
}

function RiderCell({
  rider,
  accent,
  connected,
}: {
  rider: RosterRider
  accent: string
  connected: boolean
}) {
  const dotColor = rider.color || theme.neutral.textMuted
  const boardName = rider.presence?.boardName?.trim() || 'Board not connected'
  // Only claim a rider is "Live" when our own relay link is up — otherwise the roster is just
  // the last snapshot we received and we can't know it's current.
  const fresh = !rider.stale && connected
  const statusColor = fresh ? accent : theme.neutral.textMuted
  const status = fresh ? 'Live' : 'Stale'
  const s = riderStats(rider.presence)

  return (
    <View style={styles.riderCell}>
      <View style={styles.riderHead}>
        <View style={[styles.riderDot, { backgroundColor: dotColor }]} />
        <Text style={styles.riderName} numberOfLines={1}>
          {rider.name}
        </Text>
        {rider.isSelf ? <Text style={styles.selfTag}>You</Text> : null}
      </View>
      <Text style={styles.riderBoard} numberOfLines={1}>
        {boardName}
      </Text>
      <View style={styles.statGrid}>
        <View style={styles.statRow}>
          <View style={styles.statCell}>
            <View style={styles.statIconSlot}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            </View>
            <Text style={[styles.statValue, { color: statusColor }]} numberOfLines={1}>
              {status}
            </Text>
          </View>
          <StatCell icon={DeviceMobileIcon} value={s.phone.value} level={s.phone.level} />
        </View>
        <View style={styles.statRow}>
          <StatCell icon={GaugeIcon} value={s.speed.value} level={s.speed.level} />
          <StatCell icon={ThermometerSimpleIcon} value={s.motor.value} level={s.motor.level} />
        </View>
        <View style={styles.statRow}>
          <StatCell icon={BatteryMediumIcon} value={s.soc.value} level={s.soc.level} />
          <StatCell icon={ThermometerSimpleIcon} value={s.ctrl.value} level={s.ctrl.level} />
        </View>
      </View>
    </View>
  )
}

function NearbyRideBody({ nearby }: { nearby: NearbyRide[] }) {
  const nearest = nearby[0]
  const ride = nearest.ride
  const name = ride.name?.trim() || `${ride.creator.name || 'Rider'}'s ride`
  const extra = nearby.length - 1

  return (
    <>
      <Text style={styles.rideName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.rideMeta} numberOfLines={1}>
        {ride.riderCount} {ride.riderCount === 1 ? 'rider' : 'riders'} ·{' '}
        {fmtDistance(nearest.distanceM)} away
      </Text>
      {extra > 0 ? (
        <Text style={styles.rideMetaDim}>
          +{extra} more {extra === 1 ? 'ride' : 'rides'} nearby
        </Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
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
  actionBtn: {
    backgroundColor: theme.palette.groupRide.border,
  },
  rideName: {
    color: theme.neutral.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  rideMeta: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
  },
  rideMetaDim: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    opacity: 0.7,
  },
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  riderCell: {
    // Fixed 3-up grid: a lone rider stays one column wide instead of stretching full width.
    width: '31%',
    gap: 2,
  },
  riderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  riderName: {
    flexShrink: 1,
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  selfTag: {
    color: theme.palette.groupRide.light,
    backgroundColor: theme.palette.groupRide.bg,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    overflow: 'hidden',
  },
  riderBoard: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
  },
  statGrid: {
    gap: 2,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    gap: 6,
  },
  statCell: {
    flex: 1,
    // Ignore content min-width so both columns split the row exactly 50/50 and stay aligned
    // down the grid; overflowing values ellipsize instead of pushing the column right.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Fixed-width glyph slot so every value's text starts at the same x regardless of the
  // icon's (or status dot's) intrinsic width.
  statIconSlot: {
    width: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statValue: {
    flexShrink: 1,
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
})
