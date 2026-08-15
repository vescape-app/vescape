/**
 * PROTOTYPE — throwaway. Shared pieces for the /control/speed redesign variants.
 * Delete this whole folder once a variant wins (or is folded into the real screen).
 */
import { useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowLeftIcon, SpeakerHighIcon, StopIcon } from 'phosphor-react-native'
import type { SharedValue } from 'react-native-reanimated'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { MonoValue } from '@/components/base/MonoValue'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import { type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { useAlertTest } from '@/modules/alerts/hooks/useAlertTest'
import { buildMetricAlertRuleSnapshot } from '@/modules/alerts/lib/alertTest'
import { generateAlertPresetRules, type AlertPresetLevel } from '@/modules/alerts/lib/alertPresets'
import type { MetricAlertsController } from '@/modules/alerts/hooks/useMetricAlerts'
import { telemetry } from '@/modules/board/constants/telemetry'
import type { TelemetryChartPoint, ExcludedRange } from '@/components/charts/chartMath'

export const SPEED = telemetry.speed
export const DEFAULT_MAX = SPEED.chartRange.max

export interface VariantProps {
  controller: MetricAlertsController | null
  live: SharedValue<number | null>
  points: TelemetryChartPoint[]
  windowMs: number
  excludedRanges: ExcludedRange[]
}

/** Everything a variant needs to draw the gauge + alert markers + the test sweep. */
export function useSpeedAlertModel(controller: MetricAlertsController | null) {
  const level = controller?.level ?? 'safe'
  const topSpeed = controller?.topSpeedKmh ?? 0
  const max = topSpeed > 0 ? topSpeed : DEFAULT_MAX

  const specs = useMemo(
    () => generateAlertPresetRules('speed', level, { boardTopSpeedKmh: topSpeed }),
    [level, topSpeed],
  )

  const markers = useMemo<DualGaugeAlert[]>(
    () =>
      specs.map((spec, index) => ({
        id: `speed-${index}`,
        threshold: spec.threshold,
        thresholdMax: spec.thresholdMax,
        repeats: spec.repeatEverySeconds != null,
        label: `${Math.round(spec.threshold)} km/h`,
        labelMax: spec.thresholdMax == null ? undefined : `${Math.round(spec.thresholdMax)} km/h`,
      })),
    [specs],
  )

  const testRules = useMemo(
    () =>
      controller
        ? buildMetricAlertRuleSnapshot({
            metric: controller.metric,
            level: controller.level,
            rules: controller.rules,
            boardTopSpeedKmh: controller.topSpeedKmh,
            hasBatteryConfig: controller.hasBatteryConfig,
          })
        : [],
    [controller],
  )

  const alertTest = useAlertTest({
    rules: testRules,
    min: 0,
    max,
    alertAbove: true,
    lingerNearMax: true,
  })

  return { level, max, specs, markers, testRules, alertTest }
}

/** The value a variant should bind to the gauge: the test sweep when running, else telemetry. */
export function useDisplayValue(
  live: SharedValue<number | null>,
  alertTest: ReturnType<typeof useAlertTest>,
) {
  return alertTest.running ? alertTest.value : live
}

/**
 * Scenery needle: with no board connected every readout would sit at "—", which makes the layouts
 * impossible to judge. This sweeps a plausible riding speed so the prototypes look alive.
 */
export function useMockLiveValue(enabled: boolean) {
  const value = useSharedValue<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    value.value = 24
    value.value = withRepeat(
      withSequence(
        withTiming(31, { duration: 5200 }),
        withTiming(17, { duration: 4200 }),
        withTiming(27, { duration: 3600 }),
      ),
      -1,
      true,
    )
    return () => cancelAnimation(value)
  }, [enabled, value])
  return value
}

export function TestButton({
  alertTest,
  size = 'sm',
  style,
}: {
  alertTest: ReturnType<typeof useAlertTest>
  size?: 'sm' | 'md'
  style?: object
}) {
  return (
    <Button
      label={alertTest.running ? 'Stop test' : 'Test alerts'}
      icon={alertTest.running ? StopIcon : SpeakerHighIcon}
      variant={alertTest.running ? 'destructive' : 'secondary'}
      size={size}
      disabled={!alertTest.canRun}
      onPress={alertTest.running ? alertTest.stop : alertTest.start}
      style={style}
    />
  )
}

export const LEVELS: { id: AlertPresetLevel; label: string; hint: string; tone: LevelTone }[] = [
  {
    id: 'off',
    label: 'Off',
    hint: 'Silent',
    tone: {
      color: theme.palette.slate.textSecondary,
      bg: theme.palette.slate.surface,
      border: theme.palette.slate.border,
    },
  },
  { id: 'safe', label: 'Safe', hint: 'Warns early', tone: theme.palette.blue },
  { id: 'normal', label: 'Normal', hint: 'Balanced', tone: theme.palette.green },
  { id: 'minimal', label: 'Minimal', hint: 'Only near the limit', tone: theme.palette.yellow },
]

interface LevelTone {
  color: string
  bg: string
  border: string
}

/** Back chevron + screen title, for variants that hide the native header. */
export function HeroBack({ label }: { label?: string }) {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      style={styles.back}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ArrowLeftIcon size={20} color={theme.palette.slate.textSecondary} weight="bold" />
      {label ? <Text style={styles.backLabel}>{label}</Text> : null}
    </Pressable>
  )
}

/** Big live number drawn on Skia, for variants that drop the arc. */
export function BigReadout({
  value,
  size = 96,
  color = SPEED.color,
  width,
}: {
  value: SharedValue<number | null>
  size?: number
  color?: string
  width?: number
}) {
  const text = useDerivedValue(() =>
    value.value == null ? '—' : Math.round(value.value).toString(),
  )
  return <MonoValue text={text} size={size} weight="700" color={color} align="left" width={width} />
}

/** Horizontal alert-threshold bar: a linear alternative to the arc gauge. */
export function LinearGauge({
  value,
  max,
  markers,
  height = 14,
}: {
  value: SharedValue<number | null>
  max: number
  markers: DualGaugeAlert[]
  height?: number
}) {
  const fill = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, ((value.value ?? 0) / max) * 100))}%`,
  }))
  return (
    <View style={[styles.linearTrack, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={[styles.linearFill, fill, { borderRadius: height / 2, height: height - 4 }]}
      />
      {markers.map((marker) => (
        <View
          key={marker.id}
          style={[
            styles.linearMarker,
            {
              left: `${Math.min(100, (marker.threshold / max) * 100)}%`,
              backgroundColor: theme.palette.yellow.color,
            },
          ]}
        />
      ))}
    </View>
  )
}

/**
 * Aviation-style speed tape: a ruler that slides under a fixed needle. Alert ranges are painted
 * into the tape itself, so the rider sees the warning band coming toward them.
 */
export function SpeedTape({
  value,
  max,
  markers,
  width,
  height = 92,
  pxPerUnit = 9,
}: {
  value: SharedValue<number | null>
  max: number
  markers: DualGaugeAlert[]
  width: number
  height?: number
  pxPerUnit?: number
}) {
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let v = 0; v <= Math.ceil(max) + 10; v += 5) out.push(v)
    return out
  }, [max])

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: -(value.value ?? 0) * pxPerUnit }],
  }))

  return (
    <View style={[styles.tape, { height }]}>
      <Animated.View style={[styles.tapeStrip, slide, { left: width / 2 }]}>
        {markers.map((marker) => {
          const start = marker.threshold * pxPerUnit
          const end = (marker.thresholdMax ?? max) * pxPerUnit
          return (
            <View
              key={marker.id}
              style={[styles.tapeBand, { left: start, width: Math.max(2, end - start) }]}
            />
          )
        })}
        {ticks.map((tick) => {
          const major = tick % 10 === 0
          return (
            <View key={tick} style={[styles.tapeTickWrap, { left: tick * pxPerUnit }]}>
              <View style={[styles.tapeTick, major ? styles.tapeTickMajor : null]} />
              {major ? <Text style={styles.tapeTickLabel}>{tick}</Text> : null}
            </View>
          )
        })}
      </Animated.View>
      <View style={[styles.tapeNeedle, { left: width / 2 }]} />
    </View>
  )
}

/**
 * Vertical speed ladder where the gauge and the alert editor are the same object: alert ranges
 * are lit segments of the scale, and the live needle rides the same track.
 */
export function SpeedLadder({
  value,
  max,
  markers,
  height = 300,
  tone = SPEED.color,
}: {
  value: SharedValue<number | null>
  max: number
  markers: DualGaugeAlert[]
  height?: number
  tone?: string
}) {
  const needle = useAnimatedStyle(() => ({
    bottom: Math.min(height, Math.max(0, ((value.value ?? 0) / max) * height)),
  }))

  const ticks = useMemo(() => {
    const step = max > 60 ? 20 : 10
    const out: number[] = []
    for (let v = 0; v <= max; v += step) out.push(v)
    return out
  }, [max])

  return (
    <View style={[styles.ladder, { height }]}>
      <View style={styles.ladderTrack} />
      {markers.map((marker) => {
        const bottom = (marker.threshold / max) * height
        const top = ((marker.thresholdMax ?? max) / max) * height
        return (
          <View
            key={marker.id}
            style={[styles.ladderBand, { bottom, height: Math.max(3, top - bottom) }]}
          />
        )
      })}
      {ticks.map((tick) => (
        <View key={tick} style={[styles.ladderTick, { bottom: (tick / max) * height }]}>
          <View style={styles.ladderTickLine} />
          <Text style={styles.ladderTickLabel}>{tick}</Text>
        </View>
      ))}
      <Animated.View style={[styles.ladderNeedle, needle, { backgroundColor: tone }]} />
    </View>
  )
}

/** One human sentence per generated alert rule — the thing the rider actually cares about. */
export function describeSpec(
  spec: { threshold: number; thresholdMax: number | null; repeatEverySeconds: number | null },
  max: number,
) {
  const from = Math.round(spec.threshold)
  const to = spec.thresholdMax == null ? Math.round(max) : Math.round(spec.thresholdMax)
  const cadence = spec.repeatEverySeconds == null ? 'once' : 'faster as you push'
  return { range: `${from}–${to} km/h`, cadence }
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
  },
  backLabel: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  linearTrack: {
    width: '100%',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  linearFill: {
    marginLeft: 2,
    backgroundColor: theme.alpha(theme.telemetry.speed, 0.6),
  },
  linearMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  tape: {
    width: '100%',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  tapeStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  tapeBand: {
    position: 'absolute',
    top: 0,
    bottom: 22,
    backgroundColor: theme.alpha(theme.palette.yellow.color, 0.12),
    borderLeftWidth: 1,
    borderLeftColor: theme.palette.yellow.color,
  },
  tapeTickWrap: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  tapeTick: {
    width: 1,
    height: 10,
    backgroundColor: theme.palette.slate.border,
  },
  tapeTickMajor: {
    height: 20,
    backgroundColor: theme.palette.slate.light,
  },
  tapeTickLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  tapeNeedle: {
    position: 'absolute',
    top: 0,
    bottom: 18,
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.telemetry.speed,
  },
  ladder: {
    width: 78,
    position: 'relative',
  },
  ladderTrack: {
    position: 'absolute',
    left: 30,
    top: 0,
    bottom: 0,
    width: 8,
    borderRadius: 4,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  ladderBand: {
    position: 'absolute',
    left: 30,
    width: 8,
    borderRadius: 4,
    backgroundColor: theme.alpha(theme.palette.yellow.color, 0.3),
  },
  ladderTick: {
    position: 'absolute',
    left: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ladderTickLine: {
    width: 6,
    height: 1,
    backgroundColor: theme.palette.slate.border,
  },
  ladderTickLabel: {
    color: theme.palette.slate.textDim,
    fontSize: 10,
  },
  ladderNeedle: {
    position: 'absolute',
    left: 22,
    width: 24,
    height: 2,
    borderRadius: 1,
  },
})
