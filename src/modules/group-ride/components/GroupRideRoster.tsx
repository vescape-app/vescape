import { StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
  DeviceMobileIcon,
  GaugeIcon,
  ThermometerSimpleIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { useFormat } from '@/hooks/useFormat'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import {
  TELEMETRY_LEVEL_COLOR,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import type { NearbyRide } from '@/modules/group-ride/lib/nearby'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

export function RosterGrid({
  rows,
  accent,
  connected,
}: {
  rows: RosterRider[]
  accent: ThemeColor
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
  const color = alert ? TELEMETRY_LEVEL_COLOR[level] : theme.palette.slate.textSecondary
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
  accent: ThemeColor
  connected: boolean
}) {
  const dotColor = rider.color || theme.palette.slate.textMuted
  const boardName = rider.presence?.boardName?.trim() || 'Board not connected'
  // Only claim a rider is "Live" when our own relay link is up — otherwise the roster is just
  // the last snapshot we received and we can't know it's current.
  const fresh = !rider.stale && connected
  const statusColor = fresh ? accent : theme.palette.slate.textMuted
  const status = fresh ? 'Live' : 'Stale'
  const s = useRiderStats(rider.presence)

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

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rideMeta: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
  },
  rideMetaDim: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    opacity: 0.7,
  },
  rideName: {
    color: theme.palette.slate.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  riderBoard: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
  },
  riderCell: {
    // Fixed 3-up grid: a lone rider stays one column wide instead of stretching full width.
    width: '31%',
    gap: 2,
  },
  riderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  riderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riderName: {
    flexShrink: 1,
    color: theme.palette.slate.textPrimary,
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
  statCell: {
    flex: 1,
    // Ignore content min-width so both columns split the row exactly 50/50 and stay aligned
    // down the grid; overflowing values ellipsize instead of pushing the column right.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statGrid: {
    gap: 2,
    marginTop: 2,
  },
  statIconSlot: {
    width: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    gap: 6,
  },
  statValue: {
    flexShrink: 1,
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
})
