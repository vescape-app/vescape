import { type ReactNode, useMemo } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'
import Animated, {
  useAnimatedStyle,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'

import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { RemoteTiltControl } from '@/modules/board/components/RemoteTiltControl'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { TickText } from '@/components/base/TickText'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { theme } from '@/constants/theme'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const ATTITUDE_FONT_SIZE = 11
const LIVE_FONT_SIZE = 24

const pitchCfg = telemetry.pitch
const rollCfg = telemetry.roll
const balanceCfg = telemetry.balancePitch

interface AttitudeViewProps {
  title: string
  value: SharedValue<number | null>
  unit: string
  accentColor: string
  children: ReactNode
}

function AttitudeView({ title, value, unit, accentColor, children }: AttitudeViewProps) {
  return (
    <View style={styles.attitudeView}>
      <View style={styles.attitudeHeader}>
        <Text style={styles.attitudeTitle}>{title}</Text>
        <TickText
          value={value}
          decimals={1}
          unit={unit}
          size={ATTITUDE_FONT_SIZE}
          weight="600"
          color={theme.palette.slate.textSecondary}
          align="right"
          style={styles.attitudeValue}
        />
      </View>
      <View style={[styles.attitudeAccent, { backgroundColor: accentColor }]} />
      <View style={styles.attitudeCanvas}>{children}</View>
    </View>
  )
}

interface LiveMetricReadoutProps {
  label: string
  value: SharedValue<number | null>
  decimals: number
  unit: string
  color: string
}

function LiveMetricReadout({ label, value, decimals, unit, color }: LiveMetricReadoutProps) {
  return (
    <View style={styles.liveCell}>
      <Text style={styles.liveLabel}>{label.toUpperCase()}</Text>
      <TickText
        value={value}
        decimals={decimals}
        unit={unit}
        size={LIVE_FONT_SIZE}
        weight="800"
        color={color}
        style={styles.liveValue}
      />
    </View>
  )
}

interface HotAttitudeBarsProps {
  pitch: SharedValue<number | null>
  roll: SharedValue<number | null>
  balancePitch: SharedValue<number | null>
}

function HotAttitudeBars({ pitch, roll, balancePitch }: HotAttitudeBarsProps) {
  const pitchZeroColorStyle = useAnimatedStyle<ViewStyle>(() => ({
    backgroundColor: pitch.value == null ? theme.palette.slate.textDim : theme.palette.sky.color,
  }))
  const rollZeroColorStyle = useAnimatedStyle<ViewStyle>(() => ({
    backgroundColor: roll.value == null ? theme.palette.slate.textDim : theme.palette.cyan.color,
  }))
  const balanceLineStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${balancePitch.value ?? 0}deg` }],
  }))
  const pitchBoardStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${pitch.value ?? 0}deg` }],
    backgroundColor: pitch.value == null ? theme.palette.slate.textDim : theme.palette.sky.color,
  }))
  const rollBoardStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${roll.value ?? 0}deg` }],
    backgroundColor: roll.value == null ? theme.palette.slate.textDim : theme.palette.cyan.color,
  }))

  return (
    <View style={styles.attitudeGrid}>
      <AttitudeView
        title="SIDE"
        value={pitch}
        unit={pitchCfg.unit}
        accentColor={theme.palette.sky.color}
      >
        <ZeroLevelMarker colorStyle={pitchZeroColorStyle} />
        <Animated.View style={[styles.balanceLine, balanceLineStyle]} />
        <Animated.View style={[styles.sideBoard, pitchBoardStyle]} />
      </AttitudeView>

      <AttitudeView
        title="BACK"
        value={roll}
        unit={rollCfg.unit}
        accentColor={theme.palette.cyan.color}
      >
        <ZeroLevelMarker colorStyle={rollZeroColorStyle} />
        <Animated.View style={[styles.frontBoard, rollBoardStyle]} />
      </AttitudeView>
    </View>
  )
}

interface ZeroLevelMarkerProps {
  colorStyle: AnimatedStyle<ViewStyle>
}

function ZeroLevelMarker({ colorStyle }: ZeroLevelMarkerProps) {
  return (
    <View pointerEvents="none" style={styles.zeroLevelMarker}>
      <View style={styles.zeroTick} />
      <Animated.View style={[styles.zeroRing, colorStyle]} />
      <View style={styles.zeroTick} />
    </View>
  )
}

export default function ImuScreen() {
  const pitch = useLiveMetric(liveSelectors.pitch)
  const roll = useLiveMetric(liveSelectors.roll)
  const balancePitch = useLiveMetric(liveSelectors.balancePitch)
  const windowMs = useLiveWindowMs()
  const hot = liveTelemetryRuntime.values

  // Pitch, roll and balance in one stack: they are read against each other, and one gesture over
  // the column puts the same moment under the finger on all three.
  const charts = useMemo(() => {
    const series = [
      { key: 'pitch', metric: pitchCfg, data: toChartSeries(pitch, windowMs) },
      { key: 'roll', metric: rollCfg, data: toChartSeries(roll, windowMs) },
      { key: 'balancePitch', metric: balanceCfg, data: toChartSeries(balancePitch, windowMs) },
    ]
    return series.map(({ key, metric, data }) =>
      toLiveChart({
        key,
        metric,
        data,
        range: computeAutoRangeFromValues(data.vs, { baseline: metric.chartRange }),
      }),
    )
  }, [balancePitch, pitch, roll, windowMs])

  return (
    <ControlDetailLayout title="IMU">
      <View style={styles.liveRow}>
        <LiveMetricReadout
          label={pitchCfg.label}
          value={hot.pitch}
          decimals={pitchCfg.decimals}
          unit={pitchCfg.unit}
          color={theme.palette.sky.color}
        />
        <LiveMetricReadout
          label={rollCfg.label}
          value={hot.roll}
          decimals={rollCfg.decimals}
          unit={rollCfg.unit}
          color={theme.palette.cyan.color}
        />
        <LiveMetricReadout
          label="Balance"
          value={hot.balancePitch}
          decimals={balanceCfg.decimals}
          unit={balanceCfg.unit}
          color={theme.palette.slate.textSecondary}
        />
      </View>

      <View style={styles.attitudePanel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>ATTITUDE</Text>
          <Text style={styles.sectionHint}>Gray line shows balance pitch</Text>
        </View>
        <HotAttitudeBars pitch={hot.pitch} roll={hot.roll} balancePitch={hot.balancePitch} />
      </View>

      <RemoteTiltControl />

      <LiveChartStack charts={charts} />
    </ControlDetailLayout>
  )
}

const styles = StyleSheet.create({
  liveRow: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'flex-end',
  },
  liveCell: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  liveLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  liveValue: {
    alignSelf: 'stretch',
  },
  attitudePanel: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sectionLabel: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  sectionHint: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  attitudeGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  attitudeView: {
    flex: 1,
    minHeight: 176,
    gap: 10,
  },
  attitudeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  attitudeTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  attitudeValue: {
    minWidth: 56,
  },
  attitudeAccent: {
    height: 2,
    borderRadius: 1,
  },
  attitudeCanvas: {
    flex: 1,
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  zeroLevelMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    gap: 5,
    zIndex: 2,
  },
  zeroTick: {
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.slate.textDim,
  },
  zeroRing: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 0,
    backgroundColor: theme.palette.slate.textDim,
  },
  sideBoard: {
    position: 'absolute',
    width: '72%',
    height: 3,
    borderRadius: 1.5,
  },
  balanceLine: {
    position: 'absolute',
    width: '54%',
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.slate.textMuted,
  },
  frontBoard: {
    position: 'absolute',
    width: '70%',
    height: 3,
    borderRadius: 1.5,
  },
})
