import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { ChartStack } from '@/components/charts/line/ChartStack'
import type { ChartSpec } from '@/components/charts/line/types'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { theme } from '@/constants/theme'
import { LiveNumber } from './LiveNumber'
import { GroundClearanceTiltPreview } from './GroundClearanceTiltPreview'
import { SensorBar } from './SensorBar'
import { useGroundClearancePreview } from '../hooks/useGroundClearancePreview'
import { readingCopy } from '../lib/groundClearanceCopy'

/** Preview-only display. Native owns history and statistics; calibration never rerenders at sample rate. */
export function GroundClearanceTelemetry({
  accessoryId,
  capabilityId,
  range,
}: {
  accessoryId: string
  capabilityId: string
  range: { min: number; max: number }
}) {
  const { liveValue, tiltPreviewPercent, diagnostics, reading, stalled } =
    useGroundClearancePreview(accessoryId, capabilityId)
  const colors = useResolvedAccentColors().sky
  const charts = useMemo<ChartSpec[]>(
    () => [
      {
        key: 'clearance',
        label: 'Ground clearance (cm)',
        height: 140,
        left: { range },
        series: (diagnostics?.segments ?? []).map((points, index) => {
          const ts: number[] = [],
            vs: number[] = []
          for (let i = 0; i + 1 < points.length; i += 2) {
            ts.push(points[i]!)
            vs.push(points[i + 1]!)
          }
          return {
            key: `clearance-${index}`,
            label: 'Ground clearance',
            unit: 'cm',
            decimals: 1,
            color: colors.color,
            data: { ts, vs },
          }
        }),
      },
    ],
    [diagnostics, range, colors.color],
  )
  return (
    <>
      <GroundClearanceTiltPreview value={tiltPreviewPercent} />
      <SettingsSectionTitle>Readings</SettingsSectionTitle>
      <View style={styles.reading}>
        <View style={styles.row}>
          <Text>Ground clearance</Text>
          <LiveNumber value={liveValue} decimals={1} unit="cm" />
        </View>
        <SensorBar value={liveValue} range={range} color={colors.color} />
        <Text style={styles.detail}>
          {stalled
            ? 'No fresh measurements.'
            : reading
              ? readingCopy(reading.status, reading.valueCm).detail || 'Live distance'
              : 'Waiting for measurements…'}
        </Text>
      </View>
      <SettingsSectionTitle>Link · last 20 seconds</SettingsSectionTitle>
      <View style={styles.row}>
        <Text>Delivered</Text>
        <Text>{diagnostics?.deliveredHz.toFixed(1) ?? '—'} Hz</Text>
      </View>
      <View style={styles.row}>
        <Text>Missing samples</Text>
        <Text>{diagnostics?.dropped ?? 0}</Text>
      </View>
      <View style={styles.row}>
        <Text>Invalid readings</Text>
        <Text>
          {diagnostics?.invalid ?? 0} / {diagnostics?.samples ?? 0}
        </Text>
      </View>
      <SettingsSectionTitle>History</SettingsSectionTitle>
      {charts[0]!.series.some((series) => series.data.ts.length > 1) ? (
        <ChartStack charts={charts} dataKey={accessoryId} follow timeMode="relative" showHead />
      ) : (
        <Text style={styles.detail}>
          Waiting for valid distances. Invalid readings leave gaps in the chart.
        </Text>
      )}
    </>
  )
}
const styles = StyleSheet.create({
  reading: { padding: 12, gap: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  detail: { color: theme.neutral.textSecondary, fontSize: 12, paddingHorizontal: 12 },
})
