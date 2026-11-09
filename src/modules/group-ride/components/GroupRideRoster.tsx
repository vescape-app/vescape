import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  ArrowsHorizontalIcon,
  BatteryMediumIcon,
  DeviceMobileIcon,
  GaugeIcon,
  ThermometerSimpleIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { distanceMeters } from '@/helpers/mapGeometry'
import { useFormat } from '@/hooks/useFormat'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import {
  TELEMETRY_LEVEL_COLOR,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import type { NearbyRide } from '@/modules/group-ride/lib/nearby'
import { riderSignalKindInfo } from '@/modules/group-ride/constants/riderSignalKinds'
import { riderHue } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'

type OwnLocation = { lat: number; lng: number } | null

/** Below this list width the six stat columns no longer fit one line without ellipsizing values,
 *  so each Rider's stats wrap into two lines of three. */
const ONE_LINE_STATS_MIN_WIDTH = 290

interface SignalPoint {
  latitude: number
  longitude: number
}

/** The joined ride's Riders as full-width rows whose stat columns line up like a table. A row with
 *  an active signal is tappable and hands the signal's location to `onFocusSignal`. */
export function RosterList({
  rows,
  ownLocation,
  onFocusSignal,
}: {
  rows: RosterRider[]
  ownLocation: OwnLocation
  onFocusSignal?: (point: SignalPoint) => void
}) {
  const neutral = useResolvedNeutralColors()
  const divider = theme.alpha(neutral.border, 0.6)
  const [width, setWidth] = useState(0)
  // Until measured, assume the common wide layout; narrow phones re-render once after layout.
  const wrapStats = width > 0 && width < ONE_LINE_STATS_MIN_WIDTH
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {rows.map((rider, index) => (
        <RiderRow
          key={rider.id}
          rider={rider}
          ownLocation={ownLocation}
          divider={index > 0 ? divider : undefined}
          wrapStats={wrapStats}
          onFocusSignal={onFocusSignal}
        />
      ))}
    </View>
  )
}

interface Stat {
  icon: Icon
  color: ThemeColor
  /** Share of a one-line row; wrapped lines split evenly. */
  weight: number
  value?: string
  level?: TelemetryLevel
}

/** One stat column, sized by `weight` so every row splits the width the same way. The icon, in
 *  its metric color, names the value; a missing value reads as a muted dash so real readings stand
 *  out. When `level` is warning/critical the icon and value adopt the matching alert color. */
function StatColumn({ icon: StatIcon, color, weight, value, level = 'normal' }: Stat) {
  const alert = level !== 'normal'
  const iconColor = alert ? TELEMETRY_LEVEL_COLOR[level] : color
  const valueColor = alert
    ? TELEMETRY_LEVEL_COLOR[level]
    : value
      ? theme.neutral.textPrimary
      : theme.neutral.textMuted
  return (
    <View style={[styles.statColumn, { flex: weight }]}>
      <StatIcon size={12} color={iconColor} weight="bold" />
      <Text style={[styles.statValue, { color: valueColor }]} numberOfLines={1}>
        {value ?? DASH}
      </Text>
    </View>
  )
}

/** How long an away Rider has been gone, for the badge after the board name. */
function awayLabel(lastSeen: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - lastSeen) / 60_000)
  if (minutes < 1) return 'Away'
  if (minutes < 60) return `Away ${minutes} min`
  return `Away ${Math.floor(minutes / 60)} h`
}

function RiderRow({
  rider,
  ownLocation,
  divider,
  wrapStats,
  onFocusSignal,
}: {
  rider: RosterRider
  ownLocation: OwnLocation
  divider?: string
  wrapStats: boolean
  onFocusSignal?: (point: SignalPoint) => void
}) {
  const signal = useActiveRiderSignal(rider.signal)
  const { formatDistance } = useFormat()
  const s = useRiderStats(rider.presence)
  // An away Rider's stats stay frozen at their last presence; the minute clock ages the label.
  const now = useMinuteNow(rider.away)
  // Stale (and away) mutes the dot; the Rider still owns the same palette slot.
  const dotColor = rider.stale ? theme.neutral.textMuted : theme.palette[riderHue(rider.id)].color
  const boardName = rider.presence?.boardName?.trim() || 'No board'
  const distance =
    ownLocation && rider.presence && !rider.isSelf
      ? formatDistance(
          distanceMeters(
            { latitude: ownLocation.lat, longitude: ownLocation.lng },
            { latitude: rider.presence.lat, longitude: rider.presence.lng },
          ),
        )
      : undefined
  const stats: Stat[] = [
    {
      icon: ArrowsHorizontalIcon,
      color: theme.palette.groupRide.color,
      weight: 1.5,
      value: distance,
    },
    { icon: GaugeIcon, color: theme.telemetry.speed, weight: 1, ...s.speed },
    { icon: BatteryMediumIcon, color: theme.telemetry.battVoltage, weight: 1.2, ...s.soc },
    { icon: ThermometerSimpleIcon, color: theme.telemetry.motorTemp, weight: 1, ...s.motor },
    { icon: ThermometerSimpleIcon, color: theme.telemetry.controllerTemp, weight: 1, ...s.ctrl },
    { icon: DeviceMobileIcon, color: theme.neutral.textSecondary, weight: 1.2, ...s.phone },
  ]

  return (
    <Pressable
      disabled={!signal || !onFocusSignal}
      onPress={() => signal && onFocusSignal?.({ latitude: signal.lat, longitude: signal.lng })}
      accessibilityRole={signal && onFocusSignal ? 'button' : undefined}
      accessibilityHint={signal && onFocusSignal ? 'Shows the signal on the map' : undefined}
      style={[styles.row, divider ? [styles.rowDivided, { borderTopColor: divider }] : null]}
    >
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.name} numberOfLines={1}>
          {rider.name}
        </Text>
        {rider.isSelf ? <Text style={styles.selfTag}>You</Text> : null}
        <Text style={styles.board} numberOfLines={1}>
          {boardName}
        </Text>
        {rider.away ? <Text style={styles.awayTag}>{awayLabel(rider.lastSeen, now)}</Text> : null}
        {signal ? <SignalBadge kind={signal.kind} /> : null}
      </View>
      {/* An away Rider's numbers are their last presence: dimmed, while the badge stays legible. */}
      <View style={[styles.statLines, rider.away && styles.statsAway]}>
        {(wrapStats ? [stats.slice(0, 3), stats.slice(3)] : [stats]).map((line, index) => (
          <View key={index} style={styles.stats}>
            {line.map((stat, column) => (
              <StatColumn key={column} {...stat} weight={wrapStats ? 1 : stat.weight} />
            ))}
          </View>
        ))}
      </View>
    </Pressable>
  )
}

/** The Rider's active signal, as its kind's icon and label. */
function SignalBadge({ kind }: { kind: string }) {
  const info = riderSignalKindInfo(kind)
  if (!info) return null
  const KindIcon = info.icon
  return (
    <View style={styles.signalTag} accessibilityLabel={`Signal: ${info.label}`}>
      <KindIcon size={11} color={theme.palette.red.light} weight="fill" />
      <Text style={styles.signalTagLabel} numberOfLines={1}>
        {info.label}
      </Text>
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
  signalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
    backgroundColor: theme.palette.red.bg,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  signalTagLabel: {
    color: theme.palette.red.light,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  awayTag: {
    color: theme.palette.amber.light,
    backgroundColor: theme.palette.amber.bg,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    overflow: 'hidden',
  },
  board: {
    flexShrink: 1,
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
  name: {
    flexShrink: 1,
    maxWidth: '45%',
    color: theme.neutral.textPrimary,
    fontSize: 15,
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
    gap: 6,
    paddingVertical: 10,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
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
    // Weighted flex columns with no content min-width: every row splits the same width the same
    // way, so each stat sits under the one above it and long values ellipsize instead of shifting.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stats: {
    flexDirection: 'row',
    gap: 4,
    // Line 2 starts under the name, not the dot.
    paddingLeft: DOT_SIZE + HEAD_GAP,
  },
  statLines: {
    gap: 4,
  },
  statsAway: {
    opacity: 0.5,
  },
  statValue: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
})
