import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { useRouter } from 'expo-router'

import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { theme } from '@/constants/theme'
import {
  getHistoryMetricHotRange,
  type MetricHotRange,
} from '@/modules/history/lib/metricColorScale'
import { routes } from '@/navigation/routes'
import { GaugePair } from '@/modules/board/components/DualGaugePair'
import { HUD_ARC_EDGE_INSET } from '@/modules/board/constants/telemetry'

interface DualGaugeProps {
  speedValue: SharedValue<number | null>
  dutyValue: SharedValue<number | null>
  /** Highest speed / duty across the live window, marked on each arc. */
  speedPeak?: SharedValue<number | null>
  dutyPeak?: SharedValue<number | null>
  speedMax?: number
  dutyMax?: number
  speedHotRange?: MetricHotRange | null
  dutyHotRange?: MetricHotRange | null
  speedAlerts?: DualGaugeAlert[]
  dutyAlerts?: DualGaugeAlert[]
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
  /** Hangs off the bottom of the arcs — status that qualifies what the gauges are reading. */
  footer?: ReactNode
}

// Quarter-arc geometry. Left arc sweeps π → π/2, right arc sweeps 0 → π/2,
// so the two mirror each other around the gap between them.
export function DualGauge({
  speedValue,
  dutyValue,
  speedPeak,
  dutyPeak,
  speedMax = 50,
  dutyMax = 100,
  speedHotRange = getHistoryMetricHotRange('speed'),
  dutyHotRange = getHistoryMetricHotRange('duty'),
  speedAlerts = [],
  dutyAlerts = [],
  compact = false,
  transparent = false,
  containerStyle,
  footer,
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
        <GaugePair
          speedValue={speedValue}
          dutyValue={dutyValue}
          speedPeak={speedPeak}
          dutyPeak={dutyPeak}
          speedMax={speedMax}
          dutyMax={dutyMax}
          speedAlerts={speedAlerts}
          dutyAlerts={dutyAlerts}
          speedHotRange={speedHotRange}
          dutyHotRange={dutyHotRange}
          footer={footer}
          onPressSpeed={() => router.push(routes.controlSpeed)}
          onPressDuty={() => router.push(routes.controlDuty)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
    padding: 12,
    marginHorizontal: 4,
    marginBottom: 6,
    position: 'relative',
  },
  wrapCompact: {
    paddingHorizontal: HUD_ARC_EDGE_INSET,
    paddingVertical: 2,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  wrapTransparent: {
    backgroundColor: 'transparent',
  },
  gaugeContent: { position: 'relative' },
})
