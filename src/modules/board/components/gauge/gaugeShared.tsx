import { useMemo } from 'react'
import { interpolateColor, type DerivedValue, type SharedValue } from 'react-native-reanimated'
import {
  Path,
  RadialGradient,
  Skia,
  Text as SkiaText,
  vec,
  type SkFont,
} from '@shopify/react-native-skia'

import { MonoText, TEXT_LINE_RATIO } from '@/components/base/MonoValue'
import { alertBandFractions, type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { theme, type AlphaLevel } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import type { MetricHotRange } from '@/modules/history/lib/metricColorScale'
import {
  clamp01,
  normalizeFraction,
  polar,
  radialTickPath,
  rangeWedgePath,
  STROKE,
  type Arc,
} from '@/modules/board/components/gauge/arcGeometry'
import { textAdvanceWidth } from '../../../../helpers/skiaText'

export function gaugeRampColor(
  current: number | null,
  baseColor: string,
  hotRange: MetricHotRange | null | undefined,
  hotColor: string,
) {
  'worklet'
  if (current == null || hotRange == null) return baseColor
  const start = Math.min(hotRange.start, hotRange.end)
  const end = Math.max(hotRange.start, hotRange.end)
  const span = end - start
  const fraction = span <= 0 ? 0 : clamp01((current - start) / span)
  return interpolateColor(fraction, [0, 1], [baseColor, hotColor])
}

interface GlowGradientProps {
  arc: Arc
  color: string
  stops: number[]
  opacities: AlphaLevel[]
}

export function GlowGradient({ arc, color, stops, opacities }: GlowGradientProps) {
  const colors = useMemo(() => opacities.map((o) => theme.alpha(color, o)), [color, opacities])
  return <RadialGradient c={vec(arc.cx, arc.cy)} r={arc.r} colors={colors} positions={stops} />
}

const ALERT_STOPS = [0, 0.82, 0.965, 0.99, 1]
const ALERT_OPACITIES: AlphaLevel[] = [0, 0, 0.12, 0.12, 0]

const TICK_LENGHT = 2
const TICK_WIDTH = 0.35

function AlertTick({ arc, fraction }: { arc: Arc; fraction: number }) {
  const accents = useResolvedAccentColors()
  const path = useMemo(
    () => radialTickPath(arc, fraction, TICK_LENGHT, -STROKE / 2),
    [arc, fraction],
  )
  return (
    <Path
      path={path}
      color={accents.yellow.color}
      style="stroke"
      strokeWidth={TICK_WIDTH}
      strokeCap="butt"
    />
  )
}

const LABEL_INSET = 9
export const LABEL_FONT_SIZE = 6

function AlertLabel({
  arc,
  fraction,
  text,
  font,
}: {
  arc: Arc
  fraction: number
  text: string
  font: SkFont
}) {
  const accents = useResolvedAccentColors()
  const p = polar(arc, arc.r - LABEL_INSET, fraction)
  const width = textAdvanceWidth(font, text)
  return (
    <SkiaText
      x={p.x - width / 2}
      y={p.y + LABEL_FONT_SIZE / 2}
      text={text}
      font={font}
      color={accents.yellow.color}
    />
  )
}

interface AlertMarkerProps {
  arc: Arc
  alert: DualGaugeAlert
  min?: number
  max: number
  labelFont?: SkFont | null
}

export function AlertMarker({ arc, alert, min = 0, max, labelFont = null }: AlertMarkerProps) {
  const accents = useResolvedAccentColors()
  const thresholdFraction = normalizeFraction(alert.threshold, min, max)
  const maxFraction =
    alert.thresholdMax == null ? null : normalizeFraction(alert.thresholdMax, min, max)
  const bandPath = useMemo(() => {
    const band = alertBandFractions(alert, (value) => normalizeFraction(value, min, max))
    if (!band) return null
    const d = rangeWedgePath(arc, band.from, band.to)
    return d ? Skia.Path.MakeFromSVGString(d) : null
  }, [arc, alert, min, max])

  return (
    <>
      {bandPath ? (
        <Path path={bandPath}>
          <RadialGradient
            c={vec(arc.cx, arc.cy)}
            r={arc.r}
            colors={ALERT_OPACITIES.map((o) => theme.alpha(accents.yellow.color, o))}
            positions={ALERT_STOPS}
          />
        </Path>
      ) : null}
      <AlertTick arc={arc} fraction={thresholdFraction} />
      {maxFraction != null ? <AlertTick arc={arc} fraction={maxFraction} /> : null}
      {labelFont && alert.label ? (
        <AlertLabel arc={arc} fraction={thresholdFraction} text={alert.label} font={labelFont} />
      ) : null}
      {labelFont && alert.labelMax && maxFraction != null ? (
        <AlertLabel arc={arc} fraction={maxFraction} text={alert.labelMax} font={labelFont} />
      ) : null}
    </>
  )
}

const UNIT_GAP = 2

export interface GaugeReadoutBox {
  x: number
  y: number
  width: number
  height: number
}

interface GaugeReadoutProps {
  text: DerivedValue<string>
  color: SharedValue<string> | string
  unit: string
  box: GaugeReadoutBox
  valueSize: number
  valueLineHeight: number
  unitSize: number
}

export function GaugeReadout({
  text,
  color,
  unit,
  box,
  valueSize,
  valueLineHeight,
  unitSize,
}: GaugeReadoutProps) {
  const neutral = useResolvedNeutralColors()
  const unitFont = useSkiaFont('500', unitSize)
  const unitLineHeight = Math.ceil(unitSize * TEXT_LINE_RATIO)
  const top = box.y + (box.height - (valueLineHeight + UNIT_GAP + unitLineHeight)) / 2

  const unitOrigin = useMemo(() => {
    if (!unitFont) return null
    const { ascent, descent } = unitFont.getMetrics()
    return {
      x: box.x + (box.width - textAdvanceWidth(unitFont, unit)) / 2,
      y: top + valueLineHeight + UNIT_GAP + unitLineHeight / 2 - (ascent + descent) / 2,
    }
  }, [unitFont, unit, box.x, box.width, top, valueLineHeight, unitLineHeight])

  return (
    <>
      <MonoText
        text={text}
        size={valueSize}
        color={color}
        align="center"
        x={box.x}
        y={top}
        width={box.width}
        height={valueLineHeight}
      />
      {unitOrigin && unitFont ? (
        <SkiaText
          x={unitOrigin.x}
          y={unitOrigin.y}
          text={unit}
          font={unitFont}
          color={neutral.textMuted}
        />
      ) : null}
    </>
  )
}
