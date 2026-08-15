import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BatteryChargingIcon,
  BatteryMediumIcon,
  CaretDownIcon,
  CaretUpIcon,
  ClockCountdownIcon,
  GaugeIcon,
  LightningIcon,
  RepeatIcon,
  RoadHorizonIcon,
  ThermometerHotIcon,
  ThermometerSimpleIcon,
  WaveformIcon,
} from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { HistorySession } from '@/modules/history/store/historyStore'
import { rideDurationMs } from '@/modules/history/lib/sessions'
import { interaction, theme } from '@/constants/theme'

interface HistoryStatsBarProps {
  session: HistorySession
}

interface StatItem {
  key: string
  label: string
  value: string
  unit?: string
  icon: Icon
  accent: string
}

export function HistoryStatsBar({ session }: HistoryStatsBarProps) {
  const insets = useSafeAreaInsets()
  const [expanded, setExpanded] = useState(false)
  const stats = useMemo(() => sessionToStats(session), [session])
  const primaryStats = stats.slice(0, 5)
  const secondaryStats = stats.slice(5)

  return (
    <View style={[styles.wrap, { top: Math.max(insets.top, 8) + 46 }]} pointerEvents="box-none">
      <Pressable
        testID="history-stats-bar"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Collapse ride stats' : 'Expand ride stats'}
        onPress={() => setExpanded((value) => !value)}
        android_ripple={interaction.ripple}
        style={styles.bar}
      >
        {expanded ? (
          <View style={styles.expandedPanel}>
            <View style={styles.row}>
              {primaryStats.map((item) => (
                <CompactStat key={item.key} item={item} />
              ))}
              <View style={styles.toggleCell}>
                <View style={styles.toggle}>
                  <CaretUpIcon size={16} color={theme.control.icon} weight="bold" />
                </View>
              </View>
            </View>
            <View style={styles.row}>
              {secondaryStats.map((item) => (
                <CompactStat key={item.key} item={item} />
              ))}
              <View style={styles.toggleCell} />
            </View>
          </View>
        ) : (
          <View style={styles.row}>
            {primaryStats.map((item) => (
              <CompactStat key={item.key} item={item} />
            ))}
            <View style={styles.toggleCell}>
              <View style={styles.toggle}>
                <CaretDownIcon size={16} color={theme.control.icon} weight="bold" />
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  )
}

interface CompactStatProps {
  item: StatItem
}

function CompactStat({ item }: CompactStatProps) {
  const IconComponent = item.icon
  return (
    <View style={styles.compactCell} pointerEvents="none">
      <Text style={styles.compactLabel} numberOfLines={1} adjustsFontSizeToFit>
        {item.label}
      </Text>
      <View style={styles.valueRow}>
        <IconComponent size={14} color={item.accent} weight="duotone" style={styles.icon} />
        <Text style={styles.compactValue} numberOfLines={1} adjustsFontSizeToFit>
          {item.value}
        </Text>
        {item.unit ? (
          <Text style={styles.compactUnit} numberOfLines={1}>
            {item.unit}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function sessionToStats(session: HistorySession): StatItem[] {
  return [
    {
      key: 'distance',
      label: 'Distance',
      ...formatDistance(session.distanceM),
      icon: RoadHorizonIcon,
      accent: theme.palette.sky.color,
    },
    {
      key: 'rideTime',
      label: 'Time',
      ...formatDuration(rideDurationMs(session)),
      icon: ClockCountdownIcon,
      accent: theme.palette.purple.color,
    },
    {
      key: 'topSpeed',
      label: 'Top Speed',
      value: formatSpeed(session.maxSpeedKmh),
      unit: 'km/h',
      icon: GaugeIcon,
      accent: theme.telemetry.speed,
    },
    {
      key: 'avgSpeed',
      label: 'Avg Speed',
      value: formatSpeed(session.avgSpeedKmh),
      unit: 'km/h',
      icon: RepeatIcon,
      accent: theme.palette.sky.light,
    },
    {
      key: 'maxDuty',
      label: 'Max Duty',
      value: formatDuty(session.maxDuty),
      unit: '%',
      icon: LightningIcon,
      accent: theme.telemetry.duty,
    },
    {
      key: 'mosfetTemp',
      label: 'Ctrl Max',
      ...formatTemp(session.maxTempMosfet),
      icon: ThermometerHotIcon,
      accent: theme.telemetry.controllerTemp,
    },
    {
      key: 'motorTemp',
      label: 'Motor Max',
      ...formatTemp(session.maxTempMotor),
      icon: ThermometerSimpleIcon,
      accent: theme.telemetry.motorTemp,
    },
    {
      key: 'batteryUsed',
      label: 'Used',
      ...formatWh(session.batteryUsedWh),
      icon: BatteryMediumIcon,
      accent: theme.status.warning.color,
    },
    {
      key: 'batteryRegen',
      label: 'Regen',
      ...formatWh(session.batteryRegenWh),
      icon: BatteryChargingIcon,
      accent: theme.palette.green.color,
    },
    {
      key: 'samples',
      label: 'Points',
      value: formatCount(session.sampleCount),
      icon: WaveformIcon,
      accent: theme.palette.cyan.color,
    },
  ]
}

function formatCount(value: number): string {
  if (value < 1000) return String(value)
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`
  return `${Math.round(value / 1000)}k`
}

function formatDistance(valueM: number | null): Pick<StatItem, 'value' | 'unit'> {
  if (valueM == null) return { value: '-' }
  if (valueM < 1000) return { value: String(Math.round(valueM)), unit: 'm' }
  return { value: (valueM / 1000).toFixed(1), unit: 'km' }
}

function formatDuration(valueMs: number): Pick<StatItem, 'value' | 'unit'> {
  // A zoomed window is often shorter than a minute, and "1 min" for eight seconds of riding is
  // a wrong number rather than a rounded one.
  if (valueMs < 60_000) return { value: String(Math.max(1, Math.round(valueMs / 1000))), unit: 's' }
  const totalMinutes = Math.max(1, Math.round(valueMs / 60_000))
  if (totalMinutes < 60) return { value: String(totalMinutes), unit: 'min' }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0
    ? { value: String(hours), unit: 'h' }
    : { value: String(hours), unit: `h ${minutes}m` }
}

function formatSpeed(valueKmh: number): string {
  return String(Math.round(valueKmh))
}

function formatTemp(value: number | null): Pick<StatItem, 'value' | 'unit'> {
  if (value == null) return { value: '-' }
  return { value: String(Math.round(value)), unit: '°C' }
}

function formatDuty(value: number): string {
  return String(Math.round(value * 100))
}

function formatWh(value: number): Pick<StatItem, 'value' | 'unit'> {
  if (value < 1) return { value: (value * 1000).toFixed(0), unit: 'mWh' }
  // Whole watt-hours: the cell is one line of a five-across bar, and the decimal was the digit
  // that pushed the number into shrinking to fit.
  return { value: String(Math.round(value)), unit: 'Wh' }
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 24,
    paddingTop: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  compactValue: {
    color: theme.neutral.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
    textAlign: 'left',
  },
  compactUnit: {
    color: theme.neutral.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
    marginBottom: 1,
    textAlign: 'left',
  },
  compactLabel: {
    color: theme.neutral.textMuted,
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'left',
    textTransform: 'uppercase',
  },
  compactCell: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    justifyContent: 'center',
    gap: 3,
    paddingRight: 4,
  },
  icon: {
    flexShrink: 0,
  },
  valueRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    width: '100%',
    overflow: 'hidden',
    paddingTop: 8,
    paddingBottom: 0,
    paddingLeft: 10,
    paddingRight: 0,
    gap: 8,
  },
  expandedPanel: {
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
    paddingTop: 0,
    paddingBottom: 8,
    paddingLeft: 10,
    paddingRight: 0,
    marginLeft: -10,
    gap: 8,
  },
  row: {
    width: '100%',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleCell: {
    width: 44,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  toggle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.control.background,
    borderWidth: 1,
    borderColor: theme.control.border,
  },
})
