import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { useRouter } from 'expo-router'

import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { SparklineMaxBadge, type SparklinePoint } from '@/components/charts/Sparkline'
import { theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  getHistoryMetricHotRange,
  type MetricHotRange,
} from '@/modules/history/lib/metricColorScale'
import { routes } from '@/navigation/routes'
import { GaugePair } from '@/modules/board/components/DualGaugePair'

interface DualGaugeProps {
  speedValue: SharedValue<number | null>
  dutyValue: SharedValue<number | null>
  speedSeries?: SparklinePoint[]
  dutySeries?: SparklinePoint[]
  windowMs?: number
  speedMax?: number
  dutyMax?: number
  speedHotRange?: MetricHotRange | null
  dutyHotRange?: MetricHotRange | null
  speedAlerts?: DualGaugeAlert[]
  dutyAlerts?: DualGaugeAlert[]
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

// Quarter-arc geometry. Left arc sweeps π → π/2, right arc sweeps 0 → π/2,
// so the two mirror each other around the gap between them.
export function DualGauge({
  speedValue,
  dutyValue,
  speedSeries,
  dutySeries,
  windowMs,
  speedMax = 50,
  dutyMax = 100,
  speedHotRange = getHistoryMetricHotRange('speed'),
  dutyHotRange = getHistoryMetricHotRange('duty'),
  speedAlerts = [],
  dutyAlerts = [],
  compact = false,
  transparent = false,
  containerStyle,
}: DualGaugeProps) {
  const router = useRouter()
  return (
    <View
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        transparent && styles.wrapTransparent,
        containerStyle,
      ]}
    >
      <View style={styles.gaugeContent}>
        <View style={styles.row} pointerEvents="none">
          <View style={styles.halfPressable}>
            <SparklineMaxBadge
              points={speedSeries ?? []}
              color={telemetry.speed.color}
              fmt={telemetry.speed.formatWithUnit}
              position="left"
            />
          </View>
          <View style={styles.halfPressable}>
            <SparklineMaxBadge
              points={dutySeries ?? []}
              color={telemetry.duty.color}
              fmt={telemetry.duty.formatWithUnit}
            />
          </View>
        </View>
        <GaugePair
          speedValue={speedValue}
          dutyValue={dutyValue}
          speedMax={speedMax}
          dutyMax={dutyMax}
          speedAlerts={speedAlerts}
          dutyAlerts={dutyAlerts}
          speedHotRange={speedHotRange}
          dutyHotRange={dutyHotRange}
          speedSeries={speedSeries ?? []}
          dutySeries={dutySeries ?? []}
          windowMs={windowMs}
          onPressSpeed={() => router.push(routes.controlSpeed)}
          onPressDuty={() => router.push(routes.controlDuty)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 4,
    marginBottom: 6,
    position: 'relative',
  },
  wrapCompact: {
    paddingHorizontal: 20,
    paddingVertical: 2,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  wrapTransparent: {
    backgroundColor: 'transparent',
  },
  halfPressable: {
    flex: 1,
    overflow: 'visible',
  },
  gaugeContent: { position: 'relative' },
  row: {
    flexDirection: 'row',
    gap: 32,
    position: 'relative',
  },
})
