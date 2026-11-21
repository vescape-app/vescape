import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  ArrowsHorizontalIcon,
  CaretRightIcon,
  ClockIcon,
  DeviceMobileIcon,
  GaugeIcon,
  PlugIcon,
  ThermometerSimpleIcon,
  UserCircleIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { DASH, fmtTimeAgo } from '@/helpers/format'
import { distanceMeters } from '@/helpers/mapGeometry'
import { useFormat } from '@/hooks/useFormat'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import {
  TELEMETRY_LEVEL_COLOR,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import { riderSignalKindInfo } from '@/modules/group-ride/constants/riderSignalKinds'
import { batteryVisual } from '@/modules/group-ride/lib/batteryVisual'
import { riderHue } from '@/modules/group-ride/lib/riderColor'
import type { RiderReadings } from '@/modules/group-ride/lib/riderStats'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'

type OwnLocation = { lat: number; lng: number } | null

const ONE_LINE_STATS_MIN_WIDTH = 290

export function RosterList({
  rows,
  ownLocation,
  compact = false,
  onOpenRider,
  selfCanOpen = false,
  divided = false,
  selfReadings,
}: {
  rows: RosterRider[]
  ownLocation: OwnLocation
  compact?: boolean
  onOpenRider?: (rider: RosterRider) => void
  selfCanOpen?: boolean
  divided?: boolean
  selfReadings?: RiderReadings
}) {
  const neutral = useResolvedNeutralColors()
  const divider = neutral.border
  const [width, setWidth] = useState(0)
  const wrapStats = width > 0 && width < ONE_LINE_STATS_MIN_WIDTH
  return (
    <View onLayout={compact ? undefined : (e) => setWidth(e.nativeEvent.layout.width)}>
      {rows.map((rider, index) => (
        <RiderRow
          key={rider.id}
          rider={rider}
          ownLocation={ownLocation}
          divider={divided || index > 0 ? divider : undefined}
          wrapStats={wrapStats}
          compact={compact}
          onPress={
            onOpenRider && (!rider.isSelf || selfCanOpen) ? () => onOpenRider(rider) : undefined
          }
          selfReadings={rider.isSelf ? selfReadings : undefined}
        />
      ))}
    </View>
  )
}

interface Stat {
  icon: Icon
  color: ThemeColor
  weight: number
  value?: string
  level?: TelemetryLevel
}

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
  compact,
  onPress,
  selfReadings,
}: {
  rider: RosterRider
  ownLocation: OwnLocation
  divider?: string
  wrapStats: boolean
  compact: boolean
  onPress?: () => void
  selfReadings?: RiderReadings
}) {
  const { formatDistance } = useFormat()
  const distance =
    ownLocation && rider.presence && !rider.isSelf
      ? formatDistance(
          distanceMeters(
            { latitude: ownLocation.lat, longitude: ownLocation.lng },
            { latitude: rider.presence.lat, longitude: rider.presence.lng },
          ),
        )
      : undefined
  if (compact) {
    return (
      <CompactRiderRow
        rider={rider}
        distance={distance}
        divider={divider}
        onPress={onPress}
        selfReadings={selfReadings}
      />
    )
  }
  return (
    <DetailedRiderRow rider={rider} distance={distance} divider={divider} wrapStats={wrapStats} />
  )
}

function DetailedRiderRow({
  rider,
  distance,
  divider,
  wrapStats,
}: {
  rider: RosterRider
  distance?: string
  divider?: string
  wrapStats: boolean
}) {
  const signal = useActiveRiderSignal(rider.signal)
  const s = useRiderStats(rider.presence)
  const now = useMinuteNow(rider.away)
  const dotColor = rider.stale ? theme.neutral.textMuted : theme.palette[riderHue(rider.id)].color
  const boardName = rider.presence?.boardName?.trim() || 'No board'
  const divided = divider ? [styles.rowDivided, { borderTopColor: divider }] : null
  const stats: Stat[] = [
    {
      icon: ArrowsHorizontalIcon,
      color: theme.palette.groupRide.color,
      weight: 1.5,
      value: distance,
    },
    { icon: GaugeIcon, color: theme.telemetry.speed, weight: 1, ...s.speed },
    {
      icon: batteryVisual(rider.presence?.soc).icon,
      color: theme.telemetry.battVoltage,
      weight: 1.2,
      ...s.soc,
    },
    { icon: ThermometerSimpleIcon, color: theme.telemetry.motorTemp, weight: 1, ...s.motor },
    { icon: ThermometerSimpleIcon, color: theme.telemetry.controllerTemp, weight: 1, ...s.ctrl },
    { icon: DeviceMobileIcon, color: theme.neutral.textSecondary, weight: 1.2, ...s.phone },
  ]

  return (
    <View style={[styles.row, divided]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.name} numberOfLines={1}>
          {rider.name}
        </Text>
        <SelfTag rider={rider} />
        <Text style={styles.board} numberOfLines={1}>
          {boardName}
        </Text>
        {rider.away ? <Text style={styles.awayTag}>{awayLabel(rider.lastSeen, now)}</Text> : null}
        {signal ? <SignalBadge kind={signal.kind} /> : null}
      </View>
      <View style={[styles.statLines, rider.away && styles.statsAway]}>
        {(wrapStats ? [stats.slice(0, 3), stats.slice(3)] : [stats]).map((line, index) => (
          <View key={index} style={styles.stats}>
            {line.map((stat, column) => (
              <StatColumn key={column} {...stat} weight={wrapStats ? 1 : stat.weight} />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function compactMetric(
  presence: RiderReadings | null,
  s: ReturnType<typeof useRiderStats>,
  speedUnit: ReturnType<typeof useFormat>['speedUnit'],
) {
  const motorTemp = presence?.motorTemp ?? -Infinity
  const ctrlTemp = presence?.ctrlTemp ?? -Infinity
  const hot = Math.max(motorTemp, ctrlTemp) > 80
  const lowPhone = presence?.phoneBattery != null && presence.phoneBattery < 0.3
  const MetricIcon = hot ? ThermometerSimpleIcon : lowPhone ? DeviceMobileIcon : GaugeIcon
  const metric = hot
    ? motorTemp >= ctrlTemp
      ? s.motor.value
      : s.ctrl.value
    : lowPhone
      ? s.phone.value
      : presence?.speed === 0
        ? 'Stopped'
        : s.speed.value && `${s.speed.value} ${speedUnit}`
  const metricLabel = hot
    ? motorTemp >= ctrlTemp
      ? 'Motor temperature'
      : 'Controller temperature'
    : lowPhone
      ? 'Phone battery'
      : 'Speed'
  const metricColor = hot || lowPhone ? TELEMETRY_LEVEL_COLOR.critical : theme.neutral.textSecondary
  return { MetricIcon, metric, metricLabel, metricColor }
}

type CompactRiderStatus = 'offline' | 'no-board' | 'live'

function compactRiderStatus(
  rider: RosterRider,
  presence: RiderReadings | null,
): CompactRiderStatus {
  if (rider.away || rider.stale) return 'offline'
  const hasBoard = Boolean(presence?.boardName || presence?.speed != null || presence?.soc != null)
  if ((rider.isSelf || Boolean(rider.presence)) && !hasBoard) return 'no-board'
  return 'live'
}

function compactAccessibilityLabel({
  rider,
  status,
  signalKind,
  age,
  soc,
  metric,
  metricLabel,
  distance,
}: {
  rider: RosterRider
  status: CompactRiderStatus
  signalKind?: string
  age: string | null
  soc?: string
  metric?: string
  metricLabel: string
  distance?: string
}): string {
  const readings =
    status === 'offline'
      ? ['Disconnected', age]
      : status === 'no-board'
        ? ['No board connected', distance]
        : [soc && `Board battery ${soc}`, metric && `${metricLabel} ${metric}`, distance]
  return [
    rider.name,
    rider.isSelf && 'You',
    signalKind && riderSignalKindInfo(signalKind)?.label,
    ...readings,
  ]
    .filter(Boolean)
    .join(', ')
}

function CompactRiderRow({
  rider,
  distance,
  divider,
  onPress,
  selfReadings,
}: {
  rider: RosterRider
  distance?: string
  divider?: string
  onPress?: () => void
  selfReadings?: RiderReadings
}) {
  const presence = selfReadings ?? rider.presence
  const signal = useActiveRiderSignal(rider.signal)
  const s = useRiderStats(presence)
  const { speedUnit } = useFormat()
  const status = compactRiderStatus(rider, presence)
  const offline = status === 'offline'
  const now = useMinuteNow(offline && rider.lastSeen > 0)
  const divided = divider ? [styles.rowDivided, { borderTopColor: divider }] : null
  const reading = compactMetric(presence, s, speedUnit)
  const age = offline && rider.lastSeen > 0 ? fmtTimeAgo(rider.lastSeen, now) : null
  const label = compactAccessibilityLabel({
    rider,
    status,
    signalKind: signal?.kind,
    age,
    soc: s.soc.value,
    metric: reading.metric,
    metricLabel: reading.metricLabel,
    distance,
  })
  return (
    <Pressable
      style={[styles.compactRow, divided]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? label : undefined}
      disabled={!onPress}
      onPress={onPress}
      testID={rider.isSelf ? 'social-self-profile' : `nearby-rider-${rider.id}`}
    >
      <View accessible={false}>
        <UserCircleIcon size={32} color={theme.neutral.textSecondary} weight="thin" />
      </View>
      <View style={styles.compactIdentity}>
        <View style={styles.compactHead}>
          <Text style={styles.compactName} numberOfLines={1}>
            {rider.name}
          </Text>
          {signal ? <SignalBadge kind={signal.kind} /> : null}
        </View>
        <CompactRiderStats
          status={status}
          age={age}
          soc={presence?.soc}
          battery={s.soc}
          metric={reading}
        />
      </View>
      {rider.isSelf ? (
        <View style={styles.compactBadgeSlot}>
          <Text style={[styles.selfTag, styles.compactSelfTag]}>You</Text>
        </View>
      ) : !offline && distance ? (
        <Text style={styles.distance}>{distance}</Text>
      ) : null}
      {onPress ? <CaretRightIcon size={14} color={theme.neutral.textSecondary} /> : null}
    </Pressable>
  )
}

function CompactRiderStats({
  status,
  age,
  soc,
  battery,
  metric: { MetricIcon, metric, metricColor },
}: {
  status: CompactRiderStatus
  age: string | null
  soc?: number | null
  battery: ReturnType<typeof useRiderStats>['soc']
  metric: ReturnType<typeof compactMetric>
}) {
  if (status === 'live' && !battery.value && !metric) return null
  const {
    icon: BatteryIcon,
    iconColor: batteryColor,
    textColor: batteryTextColor,
  } = batteryVisual(soc)
  return (
    <View style={styles.compactStats}>
      {status === 'offline' ? (
        <>
          <ClockIcon size={14} color={theme.palette.amber.color} />
          <View style={styles.disconnected}>
            <Text style={[styles.caption, { color: theme.palette.amber.text }]}>Disconnected</Text>
            {age ? <Text style={styles.caption}>{age}</Text> : null}
          </View>
        </>
      ) : status === 'no-board' ? (
        <>
          <PlugIcon size={14} color={theme.neutral.textSecondary} />
          <Text style={styles.caption} numberOfLines={1}>
            No board connected
          </Text>
        </>
      ) : (
        <>
          {battery.value ? (
            <View style={styles.metric}>
              <BatteryIcon size={16} color={batteryColor} />
              <Text style={[styles.caption, batteryTextColor && { color: batteryTextColor }]}>
                {battery.value}
              </Text>
            </View>
          ) : null}
          {metric ? (
            <View style={styles.metric}>
              <MetricIcon size={14} color={metricColor} />
              <Text style={[styles.caption, { color: metricColor }]} numberOfLines={1}>
                {metric}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  )
}

function SelfTag({ rider }: { rider: RosterRider }) {
  return rider.isSelf && rider.name !== 'You' ? <Text style={styles.selfTag}>You</Text> : null
}

function SignalBadge({ kind }: { kind: string }) {
  const accents = useResolvedAccentColors()
  const info = riderSignalKindInfo(kind)
  if (!info) return null
  const KindIcon = info.icon
  const hue = info.hue
  return (
    <View
      style={[styles.signalTag, { backgroundColor: accents[hue].bg }]}
      accessibilityLabel={`Signal: ${info.label}`}
    >
      <KindIcon size={11} color={theme.palette[hue].light} weight="bold" />
      <Text style={[styles.signalTagLabel, { color: theme.palette[hue].light }]} numberOfLines={1}>
        {info.label}
      </Text>
    </View>
  )
}

const DOT_SIZE = 8
const HEAD_GAP = 6

const styles = StyleSheet.create({
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 48,
    paddingVertical: 8,
  },
  compactIdentity: { flex: 1, minWidth: 0 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: HEAD_GAP },
  compactName: { flexShrink: 1, color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '700' },
  compactStats: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disconnected: { flexShrink: 1 },
  compactBadgeSlot: { width: 56, alignItems: 'center' },
  compactSelfTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.palette.groupRide.border,
  },
  distance: { color: theme.neutral.textSecondary, fontSize: 12, width: 56, textAlign: 'center' },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  caption: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    flexShrink: 1,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  signalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  signalTagLabel: {
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
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stats: {
    flexDirection: 'row',
    gap: 4,
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
