import { type ReactNode, useCallback, useMemo, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'
import {
  Canvas,
  Circle,
  LinearGradient,
  Rect,
  RoundedRect,
  useClock,
  vec,
} from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { alertBandFractions, type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { interaction, theme } from '@/constants/theme'
import { getLinearGaugeValueSlot } from '@/components/charts/linearGaugeLayout'
import { DASH } from '@/helpers/format'

const TRACK_COLOR = theme.palette.slate.border
const LINE_THICK = 2
// Sizes mirror the gauge, expressed against the line thickness (gauge STROKE):
// alert tick 0.35× wide / 2× long, marker 1.5× wide. Marker length tracks bar height.
const TICK_W = LINE_THICK * 0.35
const TICK_LEN = LINE_THICK * 2
const MARKER_W = LINE_THICK * 1.5
const MARKER_RATIO = 0.5
// Band tint fades in over the first stretch past the threshold so the edge reads as a soft entry
// rather than a wall, then holds flat: nothing about the rule escalates further along the scale.
const ALERT_BAND_COLORS = [
  theme.alpha(theme.palette.yellow.color, 0),
  theme.alpha(theme.palette.yellow.color, 0.12),
  theme.alpha(theme.palette.yellow.color, 0.12),
]
const ALERT_BAND_STOPS = [0, 0.3, 1]
const VALUE_GAP = 6
const BAR_H = 40
const BAR_H_COMPACT = 32

function clamp01(f: number) {
  return Math.min(1, Math.max(0, f))
}

function fractionOf(value: number, min: number, max: number) {
  const span = max - min
  if (span <= 0) return 0
  return clamp01((value - min) / span)
}

function useBarWidth() {
  const [width, setWidth] = useState(0)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setWidth((prev) => (prev === w ? prev : w))
  }, [])
  return { width, onLayout }
}

// Charging particles: tiny dots drifting left → right along the line, absorbed
// at the head marker. Uniform size; wide speed spread + stratified phases keep
// the stream desynced instead of clumping into one group. Count scales with
// travel span so long bars don't look sparse and short ones don't crowd.
const PARTICLE_SPACING_PX = 8
const PARTICLE_COUNT_MIN = 6
const PARTICLE_COUNT_MAX = 48
const PARTICLE_R = 0.7
const PARTICLE_FADE_IN_PX = 14
// Short fade so particles visibly slam into the head marker instead of dissolving early.
const PARTICLE_FADE_OUT_PX = 3

interface ParticleSpec {
  /** Travel speed in px/s. */
  speed: number
  /** Loop phase offset, 0–1 of the travel span. */
  phase: number
  /** Baseline height above the line, as a fraction of the marker length. */
  yFrac: number
  /** Sine-wobble amplitude, as a fraction of the marker length. */
  waveAmpFrac: number
  /** Sine-wobble angular speed in rad/s. */
  waveFreq: number
  wavePhase: number
}

function particleCountFor(headX: number): number {
  return Math.min(
    PARTICLE_COUNT_MAX,
    Math.max(PARTICLE_COUNT_MIN, Math.round(headX / PARTICLE_SPACING_PX)),
  )
}

function makeParticleSpecs(count: number): ParticleSpec[] {
  return Array.from({ length: count }, (_, i) => {
    // Amplitude spans from subtle jitter up to the full band height (0.5 of the
    // marker length swings the dot from the line to the band top). Baseline is
    // then confined so the swing never leaves the band.
    const waveAmpFrac = 0.05 + Math.random() * 0.45
    return {
      speed: 80 + Math.random() * 180,
      // Each particle starts in its own slice of the span, jittered within it.
      phase: (i + Math.random()) / count,
      yFrac: waveAmpFrac + Math.random() * (1 - 2 * waveAmpFrac),
      waveAmpFrac,
      waveFreq: 2 + Math.random() * 4,
      wavePhase: Math.random() * Math.PI * 2,
    }
  })
}

interface ChargeParticleProps {
  clock: SharedValue<number>
  spec: ParticleSpec
  /** X of the head marker — where particles get absorbed. */
  headX: number
  lineY: number
  markerLen: number
  color: string
}

function ChargeParticle({ clock, spec, headX, lineY, markerLen, color }: ChargeParticleProps) {
  const cx = useDerivedValue(() => {
    const travel = (clock.value / 1000) * spec.speed
    return ((travel / headX + spec.phase) % 1) * headX
  })
  // Sine wobble around the baseline height makes the drift read organic.
  const cy = useDerivedValue(() => {
    const base = lineY - spec.yFrac * markerLen
    const amp = spec.waveAmpFrac * markerLen
    return base - amp * Math.sin((clock.value / 1000) * spec.waveFreq + spec.wavePhase)
  })
  // Fade in from the left edge, snuff out into the head marker.
  const opacity = useDerivedValue(() => {
    const x = cx.value
    const fade = Math.min(x / PARTICLE_FADE_IN_PX, (headX - x) / PARTICLE_FADE_OUT_PX, 1)
    return Math.max(0, fade) * 0.9
  })
  return <Circle cx={cx} cy={cy} r={PARTICLE_R} color={color} opacity={opacity} />
}

function ChargeParticles({
  headX,
  lineY,
  markerLen,
  color,
}: Omit<ChargeParticleProps, 'clock' | 'spec'>) {
  const clock = useClock()
  const count = particleCountFor(headX)
  const specs = useMemo(() => makeParticleSpecs(count), [count])
  return specs.map((spec, i) => (
    <ChargeParticle
      key={i}
      clock={clock}
      spec={spec}
      headX={headX}
      lineY={lineY}
      markerLen={markerLen}
      color={color}
    />
  ))
}

interface GaugeBarProps {
  width: number
  height: number
  fraction: number
  color: string
  alerts: DualGaugeAlert[]
  min: number
  max: number
  charging: boolean
}

function GaugeBar({ width, height, fraction, color, alerts, min, max, charging }: GaugeBarProps) {
  // Line sits at the bottom (the "rim", like the gauge arc). Ticks/glow rise from it.
  const lineY = height - LINE_THICK
  const fillW = width * fraction
  const markerLen = height * MARKER_RATIO
  const bandH = height * 0.5

  return (
    <Canvas style={{ width, height }}>
      {/* Glow wedge — bounded to the head, brightest at the line, fading up (gauge glow ramp). */}
      {fillW > 0 ? (
        <Rect x={0} y={0} width={fillW} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[
              theme.alpha(color, 0),
              theme.alpha(color, 0.03),
              theme.alpha(color, 0.1),
              theme.alpha(color, 0.3),
            ]}
            positions={[0, 0.35, 0.7, 1]}
          />
        </Rect>
      ) : null}

      {/* Full dim track line at the bottom */}
      <RoundedRect
        x={0}
        y={lineY}
        width={width}
        height={LINE_THICK}
        r={LINE_THICK / 2}
        color={TRACK_COLOR}
      />

      {/* Alert bands — faint highlight tint hugging the line, fading in at the threshold edge */}
      {alerts.map((a) => {
        const band = alertBandFractions(a, (value) => fractionOf(value, min, max))
        if (!band) return null
        const from = band.from * width
        const to = band.to * width
        if (to <= from) return null
        return (
          <Rect
            key={`band-${a.id}`}
            x={from}
            y={lineY - bandH}
            width={to - from}
            height={bandH + LINE_THICK}
          >
            <LinearGradient
              start={vec(from, 0)}
              end={vec(to, 0)}
              colors={ALERT_BAND_COLORS}
              positions={ALERT_BAND_STOPS}
            />
          </Rect>
        )
      })}

      {/* Colored progress line, 0 → head */}
      {fillW > 0 ? (
        <RoundedRect
          x={0}
          y={lineY}
          width={fillW}
          height={LINE_THICK}
          r={LINE_THICK / 2}
          color={color}
        />
      ) : null}

      {/* Alert ticks — tiny highlight marks just above the line (gauge AlertTick) */}
      {alerts.map((a) => {
        const ticks = [a.threshold, ...(a.thresholdMax == null ? [] : [a.thresholdMax])]
        return ticks.map((t, i) => (
          <Rect
            key={`tick-${a.id}-${i}`}
            x={fractionOf(t, min, max) * width - TICK_W / 2}
            y={lineY - TICK_LEN}
            width={TICK_W}
            height={TICK_LEN}
            color={theme.palette.yellow.color}
          />
        ))
      })}

      {/* Charging particles streaming into the head marker. Mounted only while
          charging so the animation clock doesn't run otherwise. */}
      {charging && fillW > PARTICLE_FADE_IN_PX + PARTICLE_FADE_OUT_PX ? (
        <ChargeParticles headX={fillW} lineY={lineY} markerLen={markerLen} color={color} />
      ) : null}

      {/* Head marker at the current value — crosses the line, gauge marker proportions */}
      {fraction > 0 && fraction < 1 ? (
        <Rect
          x={fillW - MARKER_W / 2}
          y={lineY - markerLen}
          width={MARKER_W}
          height={markerLen + LINE_THICK}
          color={color}
        />
      ) : null}
    </Canvas>
  )
}

interface LinearGaugeProps {
  /** Current value, or null when unknown. */
  value: number | null
  min?: number
  max: number
  /** Stroke + value-text color (caller-resolved, e.g. low-battery warning). */
  color: string
  unit: string
  decimals?: number
  alerts?: DualGaugeAlert[]
  /** Secondary readout shown muted on the left (e.g. pack voltage). */
  aux?: ReactNode
  /** Shown when value is null. */
  hint?: string
  /** Animates particles flowing into the head marker while true. */
  charging?: boolean
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
  onPress?: () => void
  testID?: string
}

export function LinearGauge({
  value,
  min = 0,
  max,
  color,
  unit,
  decimals = 0,
  alerts = [],
  aux,
  hint,
  charging = false,
  compact,
  transparent,
  containerStyle,
  onPress,
  testID,
}: LinearGaugeProps) {
  const { width, onLayout } = useBarWidth()
  const height = compact ? BAR_H_COMPACT : BAR_H
  const fraction = value == null ? 0 : fractionOf(value, min, max)
  const valueText =
    value == null ? DASH : decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals)

  // The value rides just left of the head, its top aligned with the head marker's top.
  // Below 20% there's no room on the left, so it flips to the right of the head.
  const headX = width * fraction
  const valueSlot = getLinearGaugeValueSlot({ width, headX, compact, gap: VALUE_GAP })
  const valueSlotTop = height - LINE_THICK - height * MARKER_RATIO

  const content = (
    <>
      <View style={[styles.barArea, { height }]} onLayout={onLayout}>
        {width > 0 ? (
          <GaugeBar
            width={width}
            height={height}
            fraction={fraction}
            color={color}
            alerts={alerts}
            min={min}
            max={max}
            charging={charging && value != null}
          />
        ) : null}
        {value != null && width > 0 ? (
          <View style={[styles.valueSlot, valueSlot, { top: valueSlotTop }]} pointerEvents="none">
            <Text
              style={[styles.value, compact && styles.valueCompact, { color }]}
              numberOfLines={1}
            >
              {valueText}
              <Text style={styles.unit}>{unit}</Text>
            </Text>
          </View>
        ) : null}
        {value == null && hint ? <Text style={styles.hintCenter}>{hint}</Text> : null}
      </View>
      {aux != null ? (
        <View style={styles.underRow}>
          {typeof aux === 'string' ? <Text style={styles.auxText}>{aux}</Text> : aux}
        </View>
      ) : null}
    </>
  )

  const style = [
    styles.wrap,
    compact && styles.wrapCompact,
    transparent && styles.wrapTransparent,
    containerStyle,
  ]

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {content}
      </View>
    )
  }

  return (
    <Pressable onPress={onPress} android_ripple={interaction.ripple} testID={testID} style={style}>
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 4,
    marginBottom: 6,
    gap: 6,
  },
  wrapCompact: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 0,
    marginBottom: 0,
    gap: 4,
  },
  wrapTransparent: {
    backgroundColor: 'transparent',
  },
  barArea: {
    width: '100%',
    position: 'relative',
  },
  // Sits in [0, head − gap], right-aligned, so the value ends just left of the head marker.
  valueSlot: {
    position: 'absolute',
    left: 0,
    bottom: LINE_THICK,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  value: {
    fontSize: 16,
    fontFamily: 'monospace',
    fontWeight: '700',
    lineHeight: 18,
  },
  valueCompact: {
    fontSize: 14,
    lineHeight: 16,
  },
  unit: {
    fontSize: 9,
    fontWeight: '500',
  },
  underRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -4,
  },
  auxText: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  hintCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: LINE_THICK,
    textAlignVertical: 'center',
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
})
