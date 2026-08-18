import { memo } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import type { SharedValue } from 'react-native-reanimated'

import { Sparkline, type SparklinePoint } from '@/components/charts/Sparkline'
import { TickText } from '@/components/base/TickText'
import { interaction, theme } from '@/constants/theme'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import { useLiveSeries } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const VALUE_FONT_SIZE = 13

interface TelemetryCellProps {
  /** Short cell caption, e.g. "Motor". The unit comes from the metric. */
  label: string
  metric: TelemetryMetricConfig
  /** Live scalar, driven off the UI thread. Null renders the dimmed unit placeholder. */
  value: SharedValue<number | null>
  /** Live series key for the sparkline. Omit when passing a static `series` instead. */
  metricKey?: string
  /** Static sparkline samples, for previews that are not wired to the live runtime. */
  series?: SparklinePoint[]
  onPress?: () => void
  testID?: string
}

// Isolated so the cold-path series publish (~1Hz) re-renders only the sparkline, not the cell or
// the strip around it. TickText numbers keep updating purely off SharedValues with no React render.
const MetricSparkline = memo(function MetricSparkline({
  metricKey,
  metric,
  series,
}: {
  metricKey: string | undefined
  metric: TelemetryMetricConfig
  series: SparklinePoint[] | undefined
}) {
  const liveSeries = useLiveSeries(metricKey ?? '')
  const windowMs = useLiveWindowMs()
  return (
    <Sparkline
      points={metricKey == null ? (series ?? []) : liveSeries}
      color={metric.color}
      height={18}
      fmtMax={metric.formatWithUnit}
      showMaxBadge
      minSpan={20}
      windowMs={windowMs}
    />
  )
})

/**
 * One metric column of the bottom telemetry strip: caption, live readout, sparkline with max badge.
 *
 * With no board data the readout shows the dimmed unit and the max badge hides itself, so a
 * disconnected strip still reads as "temperature here, amps there" instead of a row of dashes.
 */
export function TelemetryCell({
  label,
  metric,
  value,
  metricKey,
  series,
  onPress,
  testID,
}: TelemetryCellProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
      android_ripple={interaction.ripple}
      onPress={onPress}
      testID={testID}
    >
      <Text style={styles.subLabel}>{label}</Text>
      <TickText
        value={value}
        decimals={metric.decimals}
        unit={metric.unit}
        size={VALUE_FONT_SIZE}
        weight="800"
        align="left"
        style={styles.value}
      />
      <MetricSparkline metricKey={metricKey} metric={metric} series={series} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cellPressed: {
    opacity: interaction.pressedOpacity,
  },
  subLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  value: {
    alignSelf: 'stretch',
  },
})
