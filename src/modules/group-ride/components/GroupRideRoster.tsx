import { StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
  DeviceMobileIcon,
  GaugeIcon,
  ThermometerSimpleIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { distanceMeters } from '@/helpers/mapGeometry'
import { useFormat } from '@/hooks/useFormat'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import {
  TELEMETRY_LEVEL_COLOR,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import type { NearbyRide } from '@/modules/group-ride/lib/nearby'
import { riderHue } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

type OwnLocation = { lat: number; lng: number } | null

/** The joined ride's Riders as full-width two-line rows whose stat columns line up like a table. */
export function RosterList({
  rows,
  ownLocation,
}: {
  rows: RosterRider[]
  ownLocation: OwnLocation
}) {
  return (
    <View style={styles.list}>
      {rows.map((rider) => (
        <RiderRow key={rider.id} rider={rider} ownLocation={ownLocation} />
      ))}
    </View>
  )
}

/** One fixed-width stat column: its icon is always shown; a missing value reads as a dash.
 *  When `level` is warning/critical the icon and value adopt the matching alert color. */
function StatColumn({
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
    <View style={styles.statColumn}>
      <StatIcon size={11} color={color} weight="bold" />
      <Text style={[styles.statValue, alert && { color }]} numberOfLines={1}>
        {value ?? DASH}
      </Text>
    </View>
  )
}

/** How long an away Rider has been gone, for the slot the distance usually takes. */
function awayLabel(lastSeen: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - lastSeen) / 60_000)
  if (minutes < 1) return 'away'
  if (minutes < 60) return `away · ${minutes} min`
  return `away · ${Math.floor(minutes / 60)} h`
}

function RiderRow({ rider, ownLocation }: { rider: RosterRider; ownLocation: OwnLocation }) {
  const { formatDistance } = useFormat()
  const s = useRiderStats(rider.presence)
  // An away Rider's stats stay frozen at their last presence; the minute clock ages the label.
  const now = useMinuteNow(rider.away)
  // Stale (and away) mutes the dot; the Rider still owns the same palette slot.
  const dotColor = rider.stale ? theme.neutral.textMuted : theme.palette[riderHue(rider.id)].color
  const boardName = rider.presence?.boardName?.trim() || 'No board'
  const distance =
    ownLocation && rider.presence
      ? formatDistance(
          distanceMeters(
            { latitude: ownLocation.lat, longitude: ownLocation.lng },
            { latitude: rider.presence.lat, longitude: rider.presence.lng },
          ),
        )
      : DASH
  const trailing = rider.away ? awayLabel(rider.lastSeen, now) : rider.isSelf ? null : distance

  return (
    <View style={[styles.row, rider.away && styles.rowAway]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.name} numberOfLines={1}>
          {rider.name}
        </Text>
        {rider.isSelf ? <Text style={styles.selfTag}>You</Text> : null}
        <Text style={styles.board} numberOfLines={1}>
          {boardName}
        </Text>
        {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
      </View>
      <View style={styles.stats}>
        <StatColumn icon={GaugeIcon} value={s.speed.value} level={s.speed.level} />
        <StatColumn icon={BatteryMediumIcon} value={s.soc.value} level={s.soc.level} />
        <StatColumn icon={ThermometerSimpleIcon} value={s.motor.value} level={s.motor.level} />
        <StatColumn icon={ThermometerSimpleIcon} value={s.ctrl.value} level={s.ctrl.level} />
        <StatColumn icon={DeviceMobileIcon} value={s.phone.value} level={s.phone.level} />
      </View>
    </View>
  )
}

export function NearbyRideBody({ nearby }: { nearby: NearbyRide[] }) {
  const { formatDistance } = useFormat()
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
        {formatDistance(nearest.distanceM)} away
      </Text>
      {extra > 0 ? (
        <Text style={styles.rideMetaDim}>
          +{extra} more {extra === 1 ? 'ride' : 'rides'} nearby
        </Text>
      ) : null}
    </>
  )
}

const DOT_SIZE = 8
const HEAD_GAP = 6

const styles = StyleSheet.create({
  board: {
    flex: 1,
    minWidth: 0,
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEAD_GAP,
  },
  list: {
    gap: 12,
  },
  name: {
    flexShrink: 1,
    maxWidth: '45%',
    color: theme.neutral.textPrimary,
    fontSize: 14,
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
  rideName: {
    color: theme.neutral.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  row: {
    gap: 4,
  },
  rowAway: {
    opacity: 0.5,
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
  statColumn: {
    // Equal flex columns with no content min-width: every row splits the same width the same way,
    // so each stat sits under the one above it and long values ellipsize instead of shifting.
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stats: {
    flexDirection: 'row',
    gap: 6,
    // Line 2 starts under the name, not the dot.
    paddingLeft: DOT_SIZE + HEAD_GAP,
  },
  statValue: {
    flexShrink: 1,
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  trailing: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
})
