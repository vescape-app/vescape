import {
  Canvas,
  Circle,
  RoundedRect,
  LinearGradient,
  Rect,
  useClock,
  vec,
} from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { alertBandFractions, type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'

const TRACK_COLOR = theme.palette.slate.border
export const LINE_THICK = 2
const TICK_W = LINE_THICK * 0.35
const TICK_LEN = LINE_THICK * 2
export const BAND_RATIO = 0.5
const ALERT_BAND_STOPS = [0, 0.3, 1]
export const VALUE_GAP = 6
export const BAR_H = 40
export const BAR_H_COMPACT = 32

export function clamp01(f: number) {
  return f < 0 ? 0 : f > 1 ? 1 : f
}

export function fractionOf(value: number, min: number, max: number) {
  const span = max - min
  return span <= 0 ? 0 : clamp01((value - min) / span)
}

const PARTICLE_SPACING_PX = 8
const PARTICLE_COUNT_MIN = 6
const PARTICLE_COUNT_MAX = 48
const PARTICLE_R = 0.7
const PARTICLE_FADE_IN_PX = 14
const PARTICLE_FADE_OUT_PX = 3

interface ParticleSpec {
  speed: number
  phase: number
  yFrac: number
  waveAmpFrac: number
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
    const waveAmpFrac = 0.05 + Math.random() * 0.45
    return {
      speed: 80 + Math.random() * 180,
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
  headX: number
  lineY: number
  bandLen: number
  color: string
}

function ChargeParticle({ clock, spec, headX, lineY, bandLen, color }: ChargeParticleProps) {
  const cx = useDerivedValue(() => {
    const travel = (clock.value / 1000) * spec.speed
    return ((travel / headX + spec.phase) % 1) * headX
  })
  const cy = useDerivedValue(() => {
    const base = lineY - spec.yFrac * bandLen
    const amp = spec.waveAmpFrac * bandLen
    return base - amp * Math.sin((clock.value / 1000) * spec.waveFreq + spec.wavePhase)
  })
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
  bandLen,
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
      bandLen={bandLen}
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

export function GaugeBar({
  width,
  height,
  fraction,
  color,
  alerts,
  min,
  max,
  charging,
}: GaugeBarProps) {
  const accents = useResolvedAccentColors()
  const alertColor = accents.yellow.color
  const alertBandColors = useMemo(
    () => [
      theme.alpha(alertColor, 0),
      theme.alpha(alertColor, 0.12),
      theme.alpha(alertColor, 0.12),
    ],
    [alertColor],
  )
  const lineY = height - LINE_THICK
  const fillW = width * fraction
  const bandLen = height * BAND_RATIO
  const bandH = height * 0.5

  return (
    <Canvas style={{ width, height }}>
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

      <RoundedRect
        x={0}
        y={lineY}
        width={width}
        height={LINE_THICK}
        r={LINE_THICK / 2}
        color={TRACK_COLOR}
      />

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
              colors={alertBandColors}
              positions={ALERT_BAND_STOPS}
            />
          </Rect>
        )
      })}

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

      {alerts.map((a) => {
        const ticks = [a.threshold, ...(a.thresholdMax == null ? [] : [a.thresholdMax])]
        return ticks.map((t, i) => (
          <Rect
            key={`tick-${a.id}-${i}`}
            x={fractionOf(t, min, max) * width - TICK_W / 2}
            y={lineY - TICK_LEN}
            width={TICK_W}
            height={TICK_LEN}
            color={alertColor}
          />
        ))
      })}

      {charging && fillW > PARTICLE_FADE_IN_PX + PARTICLE_FADE_OUT_PX ? (
        <ChargeParticles headX={fillW} lineY={lineY} bandLen={bandLen} color={color} />
      ) : null}
    </Canvas>
  )
}
