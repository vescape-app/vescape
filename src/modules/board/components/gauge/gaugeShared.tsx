import { useCallback, useMemo, useState } from 'react'
import { TextInput, type LayoutChangeEvent } from 'react-native'
import Animated, { interpolateColor } from 'react-native-reanimated'
import {
  Path,
  RadialGradient,
  Skia,
  Text as SkiaText,
  vec,
  type SkFont,
} from '@shopify/react-native-skia'

import { type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { accentColors, theme, type AlphaLevel } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { type MetricHotRange } from '@/modules/history/lib/metricColorScale'
import {
  clamp01,
  normalizeFraction,
  polar,
  radialTickPath,
  rangeWedgePath,
  STROKE,
  type Arc,
} from '@/modules/board/components/gauge/arcGeometry'

export const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

const GAUGE_HOT_COLOR = accentColors.dark.red.color

/** Ramp the gauge color toward the hot color across the metric's hot range. */
export function gaugeRampColor(
  current: number | null,
  baseColor: string,
  hotRange: MetricHotRange | null | undefined,
) {
  'worklet'
  if (current == null || hotRange == null) return baseColor
  const start = Math.min(hotRange.start, hotRange.end)
  const end = Math.max(hotRange.start, hotRange.end)
  const span = end - start
  const fraction = span <= 0 ? 0 : clamp01((current - start) / span)
  return interpolateColor(fraction, [0, 1], [baseColor, GAUGE_HOT_COLOR])
}

// ── Gradients ────────────────────────────────────────────────────────────────

interface GlowGradientProps {
  arc: Arc
  color: string
  /** Stop offsets + opacities, matching the SVG RadialGradient stops. */
  stops: number[]
  opacities: AlphaLevel[]
}

export function GlowGradient({ arc, color, stops, opacities }: GlowGradientProps) {
  const colors = useMemo(() => opacities.map((o) => theme.alpha(color, o)), [color, opacities])
  return <RadialGradient c={vec(arc.cx, arc.cy)} r={arc.r} colors={colors} positions={stops} />
}

const ALERT_STOPS = [0, 0.82, 0.965, 0.99, 1]
const ALERT_OPACITIES: AlphaLevel[] = [0, 0, 0.3, 0.3, 0]

// ── Alert markers ────────────────────────────────────────────────────────────

const TICK_LENGHT = 2
const TICK_WIDTH = 0.35

function AlertTick({ arc, fraction, color }: { arc: Arc; fraction: number; color: string }) {
  const path = useMemo(
    () => radialTickPath(arc, fraction, TICK_LENGHT, -STROKE / 2),
    [arc, fraction],
  )
  return <Path path={path} color={color} style="stroke" strokeWidth={TICK_WIDTH} strokeCap="butt" />
}

// Numeric marker labels sit just inside the arc, centered on the tick.
const LABEL_INSET = 9
export const LABEL_FONT_SIZE = 6

function AlertLabel({
  arc,
  fraction,
  text,
  font,
  color,
}: {
  arc: Arc
  fraction: number
  text: string
  font: SkFont
  color: string
}) {
  const p = polar(arc, arc.r - LABEL_INSET, fraction)
  const width = font.getTextWidth(text)
  return (
    <SkiaText
      x={p.x - width / 2}
      y={p.y + LABEL_FONT_SIZE / 2}
      text={text}
      font={font}
      color={color}
    />
  )
}

interface AlertMarkerProps {
  arc: Arc
  alert: DualGaugeAlert
  min?: number
  max: number
  /** Null on gauges too small to carry readable numeric labels. */
  labelFont?: SkFont | null
}

export function AlertMarker({ arc, alert, min = 0, max, labelFont = null }: AlertMarkerProps) {
  const accents = useResolvedAccentColors()
  const thresholdFraction = normalizeFraction(alert.threshold, min, max)
  const maxFraction =
    alert.thresholdMax == null ? null : normalizeFraction(alert.thresholdMax, min, max)
  const rangePath = useMemo(() => {
    if (maxFraction == null) return null
    const d = rangeWedgePath(arc, thresholdFraction, maxFraction)
    return d ? Skia.Path.MakeFromSVGString(d) : null
  }, [arc, thresholdFraction, maxFraction])

  const range = maxFraction != null && rangePath ? { path: rangePath, fraction: maxFraction } : null

  return (
    <>
      {range ? (
        <Path path={range.path}>
          <RadialGradient
            c={vec(arc.cx, arc.cy)}
            r={arc.r}
            colors={ALERT_OPACITIES.map((o) => theme.alpha(accents.yellow.color, o))}
            positions={ALERT_STOPS}
          />
        </Path>
      ) : null}
      <AlertTick arc={arc} fraction={thresholdFraction} color={accents.yellow.color} />
      {range ? (
        <AlertTick arc={arc} fraction={range.fraction} color={accents.yellow.color} />
      ) : null}
      {labelFont && alert.label ? (
        <AlertLabel
          arc={arc}
          fraction={thresholdFraction}
          text={alert.label}
          font={labelFont}
          color={accents.yellow.text}
        />
      ) : null}
      {labelFont && alert.labelMax && range ? (
        <AlertLabel
          arc={arc}
          fraction={range.fraction}
          text={alert.labelMax}
          font={labelFont}
          color={accents.yellow.text}
        />
      ) : null}
    </>
  )
}

/** Measured size of a gauge canvas host view, for viewBox → pixel scaling. */
export function useCanvasSize() {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
  }, [])
  return { size, onLayout }
}
