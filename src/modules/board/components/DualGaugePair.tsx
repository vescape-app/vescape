import { useUnitSystem } from '@/hooks/useUnitSystem'
import { speedFromKmh, speedUnit } from '@/helpers/units'
import { useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { Canvas, Group, Path, Text as SkiaText } from '@shopify/react-native-skia'

import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { useCanvasSize } from '@/hooks/useCanvasSize'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { textAdvanceWidth } from '@/helpers/skiaText'
import { DASH } from '@/helpers/format'
import { interaction, theme, type AlphaLevel } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedTelemetryColors } from '@/hooks/useTheme'
import type { MetricHotRange } from '@/modules/history/lib/metricColorScale'
import {
  arcPath,
  clamp01,
  polar,
  radialTickPath,
  segmentPath,
  STROKE,
  svgPath,
  wedgePath,
  type Arc,
} from '@/modules/board/components/gauge/arcGeometry'
import {
  AlertMarker,
  gaugeRampColor,
  GaugeReadout,
  GlowGradient,
  type GaugeReadoutBox,
} from '@/modules/board/components/gauge/gaugeShared'

const R = 80
const VB_H = 120
const MARKER_INSET = 10
const LEFT_ARC: Arc = { cx: 100, cy: 100, r: R, from: Math.PI, to: Math.PI / 2 }
const RIGHT_ARC: Arc = { cx: 10, cy: 100, r: R, from: 0, to: Math.PI / 2 }

// Readout box: line height is set explicitly so the drawn value keeps the same
// vertical footprint the readout view used to reserve.
const VALUE_FONT_SIZE = 36
const VALUE_LINE_HEIGHT = 40
const UNIT_FONT_SIZE = 10

// Cropped viewBox per side — removes empty space so arc fills container width
const CROP_PAD = 1
const CROP_TOP = 12
const VB_CROP_W = R + CROP_PAD * 2
const VB_CROP_H = VB_H - CROP_TOP
const VB_CROP_LEFT_X = LEFT_ARC.cx - R - CROP_PAD
const VB_CROP_RIGHT_X = RIGHT_ARC.cx - CROP_PAD

// Arcs end at the arc centre line (cy), well above the bottom of the gauge box.
// The touch row is clipped to that so it matches what the rider actually sees.
const ARC_BOTTOM_RATIO = (LEFT_ARC.cy - CROP_TOP) / VB_CROP_H

const ARC_GAP = 32

// Peak marker, in arc units: a faint tick across the stroke with the value just outside the arc.
const PEAK_TICK_INSET = 3.5
const PEAK_TICK_OUTSET = 2
const PEAK_LABEL_SIZE = 6
const PEAK_LABEL_GAP = 1
/** Level line from the tick's outer end to the value, so the value reads as level with it. */
const PEAK_LEADER_LENGTH = 2.5
/** Low peaks are of no interest, and lower on the arc the label would run off the screen. */
const PEAK_MIN_FRACTION = 0.4

const GLOW_STOPS = [0, 0.6, 0.95, 1]
const GLOW_OPACITIES: AlphaLevel[] = [0, 0, 0.12, 0.3]

const BG_ARC_LEFT = svgPath(arcPath(LEFT_ARC, 1))
const BG_ARC_RIGHT = svgPath(arcPath(RIGHT_ARC, 1))

interface QuarterArcProps {
  side: 'left' | 'right'
  value: SharedValue<number | null>
  max: number
  color: string
  unit: string
  displayScale?: number
  alerts?: DualGaugeAlert[]
  hotRange?: MetricHotRange | null
  /** Highest value across the live window, marked on the arc. */
  peak?: SharedValue<number | null>
}

interface QuarterArcLayerProps extends QuarterArcProps {
  transform: ({ translateX: number } | { translateY: number } | { scale: number })[]
}

function QuarterArcLayer({
  side,
  value,
  max,
  color,
  alerts = [],
  hotRange,
  peak,
  displayScale,
  transform,
}: QuarterArcLayerProps) {
  'use no memo'
  const accents = useResolvedAccentColors()
  const isLeft = side === 'left'
  const arc = isLeft ? LEFT_ARC : RIGHT_ARC

  const arcPathValue = useDerivedValue(() =>
    svgPath(arcPath(arc, clamp01((value.value ?? 0) / max))),
  )
  const arcColor = useDerivedValue(() =>
    gaugeRampColor(value.value ?? 0, color, hotRange, accents.red.color),
  )
  const wedgePathValue = useDerivedValue(() =>
    svgPath(wedgePath(arc, clamp01((value.value ?? 0) / max))),
  )
  const markerPath = useDerivedValue(() =>
    radialTickPath(arc, clamp01((value.value ?? 0) / max), MARKER_INSET),
  )

  return (
    <Group transform={transform}>
      {/* Gradient wedge fill */}
      <Path path={wedgePathValue}>
        <GlowGradient arc={arc} color={color} stops={GLOW_STOPS} opacities={GLOW_OPACITIES} />
      </Path>

      {/* Static background arc */}
      <Path
        path={isLeft ? BG_ARC_LEFT : BG_ARC_RIGHT}
        color={theme.palette.slate.border}
        style="stroke"
        strokeWidth={STROKE}
        strokeCap="butt"
      />

      {/* Animated colored arc overlay */}
      <Path
        path={arcPathValue}
        color={arcColor}
        style="stroke"
        strokeWidth={STROKE}
        strokeCap="butt"
      />

      {alerts.map((alert) => (
        <AlertMarker key={alert.id} arc={arc} alert={alert} max={max} />
      ))}

      {peak ? (
        <PeakMarker
          arc={arc}
          side={side}
          peak={peak}
          max={max}
          color={color}
          displayScale={displayScale}
        />
      ) : null}

      {/* Position marker */}
      <Path path={markerPath} color={arcColor} style="stroke" strokeWidth={1.5} strokeCap="butt" />
    </Group>
  )
}

/**
 * Where the live window topped out: a tick across the arc, then a short level line out to the value
 * on the gauge's outer side — left of the speed arc, right of the duty arc — clear of the top bar.
 * Hidden while the peak is low on the arc.
 */
function PeakMarker({
  arc,
  side,
  peak,
  max,
  color,
  displayScale = 1,
}: {
  arc: Arc
  side: 'left' | 'right'
  peak: SharedValue<number | null>
  max: number
  color: string
  displayScale?: number
}) {
  'use no memo'
  const font = useSkiaMonoFont('600', PEAK_LABEL_SIZE)
  const fraction = useDerivedValue(() => clamp01((peak.value ?? 0) / max))
  const opacity = useDerivedValue(() =>
    peak.value != null && fraction.value >= PEAK_MIN_FRACTION ? 1 : 0,
  )
  const tick = useDerivedValue(() =>
    radialTickPath(arc, fraction.value, PEAK_TICK_INSET, PEAK_TICK_OUTSET),
  )
  const text = useDerivedValue(() =>
    peak.value == null ? '' : Math.round(peak.value * displayScale).toString(),
  )
  const anchor = useDerivedValue(() => polar(arc, arc.r + PEAK_TICK_OUTSET, fraction.value))
  const leaderEnd = useDerivedValue(() =>
    side === 'left' ? anchor.value.x - PEAK_LEADER_LENGTH : anchor.value.x + PEAK_LEADER_LENGTH,
  )
  const leader = useDerivedValue(() =>
    segmentPath(anchor.value.x, anchor.value.y, leaderEnd.value, anchor.value.y),
  )
  const labelX = useDerivedValue(() => {
    const width = font ? textAdvanceWidth(font, text.value) : 0
    return side === 'left'
      ? leaderEnd.value - PEAK_LABEL_GAP - width
      : leaderEnd.value + PEAK_LABEL_GAP
  })
  const labelY = useDerivedValue(() => anchor.value.y + PEAK_LABEL_SIZE * 0.36)

  return (
    <>
      <Path
        path={tick}
        color={theme.alpha(color, 0.7)}
        style="stroke"
        strokeWidth={0.6}
        strokeCap="round"
        opacity={opacity}
      />
      <Path
        path={leader}
        color={theme.alpha(color, 0.7)}
        style="stroke"
        strokeWidth={0.6}
        strokeCap="round"
        opacity={opacity}
      />
      {font ? (
        <SkiaText
          x={labelX}
          y={labelY}
          text={text}
          font={font}
          color={theme.alpha(color, 0.8)}
          opacity={opacity}
        />
      ) : null}
    </>
  )
}

function GaugeValueLayer({
  value,
  color,
  hotRange,
  unit,
  displayScale = 1,
  box,
}: Omit<QuarterArcProps, 'side' | 'max'> & { box: GaugeReadoutBox }) {
  'use no memo'
  const accents = useResolvedAccentColors()
  const valueText = useDerivedValue(() => {
    const current = value.value
    return current != null ? Math.round(current * displayScale).toString() : DASH
  })
  const valueColor = useDerivedValue(() =>
    gaugeRampColor(value.value, color, hotRange, accents.red.color),
  )
  return (
    <GaugeReadout
      text={valueText}
      color={valueColor}
      unit={unit}
      box={box}
      valueSize={VALUE_FONT_SIZE}
      valueLineHeight={VALUE_LINE_HEIGHT}
      unitSize={UNIT_FONT_SIZE}
    />
  )
}

interface GaugePairProps {
  speedValue: SharedValue<number | null>
  dutyValue: SharedValue<number | null>
  speedPeak?: SharedValue<number | null>
  dutyPeak?: SharedValue<number | null>
  speedMax: number
  dutyMax: number
  speedAlerts: DualGaugeAlert[]
  dutyAlerts: DualGaugeAlert[]
  speedHotRange: MetricHotRange | null
  dutyHotRange: MetricHotRange | null
  /** Rendered against the bottom of the arcs, inside the space the gauge box leaves below them. */
  footer?: ReactNode
  onPressSpeed: () => void
  onPressDuty: () => void
}

export function GaugePair({
  speedValue,
  dutyValue,
  speedPeak,
  dutyPeak,
  speedMax,
  dutyMax,
  speedAlerts,
  dutyAlerts,
  speedHotRange,
  dutyHotRange,
  footer,
  onPressSpeed,
  onPressDuty,
}: GaugePairProps) {
  const units = useUnitSystem()
  const telemetryColors = useResolvedTelemetryColors()
  const { size, onLayout } = useCanvasSize()
  const cellWidth = Math.max(0, (size.w - ARC_GAP) / 2)
  const scale = cellWidth / VB_CROP_W
  const gaugeHeight = cellWidth * (VB_CROP_H / VB_CROP_W)
  const leftTransform = useMemo(
    () => [{ translateX: -VB_CROP_LEFT_X * scale }, { translateY: -CROP_TOP * scale }, { scale }],
    [scale],
  )
  const rightTransform = useMemo(
    () => [
      { translateX: cellWidth + ARC_GAP - VB_CROP_RIGHT_X * scale },
      { translateY: -CROP_TOP * scale },
      { scale },
    ],
    [cellWidth, scale],
  )
  // Bowls the readouts are centered in, in canvas pixels. They used to be
  // percentage-positioned overlay views; the numbers match those percentages.
  // Where the drawn gauges actually end. The box is a fixed aspect ratio and the arcs stop at
  // their centre line, so everything below this — the touch row's floor, the footer slot — has to
  // be placed against this line rather than against the box.
  const arcBottom = gaugeHeight * ARC_BOTTOM_RATIO
  const bowlTop = gaugeHeight * 0.1
  const bowl = {
    y: bowlTop,
    width: size.w * 0.4,
    height: gaugeHeight * 0.95 - bowlTop,
  }
  return (
    // The touch cells size the box: each holds the arcs' fixed aspect and the gap between them is
    // fixed, so no single aspect ratio fits every screen, but the cells lay it out in one pass.
    <View style={styles.gaugePair} onLayout={onLayout}>
      {scale > 0 ? (
        <Canvas style={styles.svg}>
          <QuarterArcLayer
            side="left"
            value={speedValue}
            max={speedMax}
            color={telemetryColors.speed}
            unit={speedUnit(units)}
            alerts={speedAlerts}
            hotRange={speedHotRange}
            peak={speedPeak}
            displayScale={speedFromKmh(1, units)}
            transform={leftTransform}
          />
          <QuarterArcLayer
            side="right"
            value={dutyValue}
            max={dutyMax}
            color={telemetryColors.duty}
            unit="%"
            alerts={dutyAlerts}
            hotRange={dutyHotRange}
            peak={dutyPeak}
            transform={rightTransform}
          />
          <GaugeValueLayer
            displayScale={speedFromKmh(1, units)}
            value={speedValue}
            color={telemetryColors.speed}
            unit={speedUnit(units)}
            hotRange={speedHotRange}
            box={{ ...bowl, x: size.w * 0.05 }}
          />
          <GaugeValueLayer
            value={dutyValue}
            color={telemetryColors.duty}
            unit="%"
            hotRange={dutyHotRange}
            box={{ ...bowl, x: size.w * 0.55 }}
          />
        </Canvas>
      ) : null}
      <View style={styles.gaugeTouchRow}>
        <View style={styles.cell}>
          <Pressable
            style={styles.halfPressable}
            testID="gauge-speed"
            onPress={onPressSpeed}
            android_ripple={interaction.ripple}
          />
        </View>
        <View style={styles.cell}>
          <Pressable
            style={styles.halfPressable}
            testID="gauge-duty"
            onPress={onPressDuty}
            android_ripple={interaction.ripple}
          />
        </View>
      </View>
      {footer ? (
        <View pointerEvents="box-none" style={[styles.footer, { top: arcBottom }]}>
          {footer}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  gaugePair: { width: '100%', position: 'relative' },
  gaugeTouchRow: {
    flexDirection: 'row',
    gap: ARC_GAP,
  },
  footer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  cell: {
    flex: 1,
    aspectRatio: VB_CROP_W / VB_CROP_H,
  },
  // Touch stops where the arcs do, leaving the footer's strip below to the footer.
  halfPressable: {
    height: `${ARC_BOTTOM_RATIO * 100}%`,
    overflow: 'visible',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
})
