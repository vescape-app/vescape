import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { Canvas, Group, Path } from '@shopify/react-native-skia'

import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import type { SparklinePoint } from '@/components/charts/Sparkline'
import { buildSparklinePaths, SparklineLayer } from '@/components/charts/SparklineLayer'
import { useCanvasSize } from '@/hooks/useCanvasSize'
import { DASH } from '@/helpers/format'
import { interaction, type AlphaLevel } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import type { MetricHotRange } from '@/modules/history/lib/metricColorScale'
import {
  arcPath,
  clamp01,
  radialTickPath,
  STROKE,
  svgPath,
  wedgePath,
  type Arc,
} from '@/modules/board/components/gauge/arcGeometry'
import {
  AlertMarker,
  BG_ARC_COLOR,
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

const SPARKLINE_HEIGHT = 28
const SPARKLINE_TOP = 12
const SPARKLINE_GAP = 32

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
  alerts?: DualGaugeAlert[]
  hotRange?: MetricHotRange | null
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
  transform,
}: QuarterArcLayerProps) {
  const isLeft = side === 'left'
  const arc = isLeft ? LEFT_ARC : RIGHT_ARC

  const arcPathValue = useDerivedValue(() =>
    svgPath(arcPath(arc, clamp01((value.value ?? 0) / max))),
  )
  const arcColor = useDerivedValue(() => gaugeRampColor(value.value ?? 0, color, hotRange))
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
        color={BG_ARC_COLOR}
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

      {/* Position marker */}
      <Path path={markerPath} color={arcColor} style="stroke" strokeWidth={1.5} strokeCap="butt" />
    </Group>
  )
}

function GaugeValueLayer({
  value,
  color,
  hotRange,
  unit,
  box,
}: Omit<QuarterArcProps, 'side' | 'max'> & { box: GaugeReadoutBox }) {
  const valueText = useDerivedValue(() => {
    const current = value.value
    return current != null ? Math.round(current).toString() : DASH
  })
  const valueColor = useDerivedValue(() => gaugeRampColor(value.value, color, hotRange))
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
  speedMax: number
  dutyMax: number
  speedAlerts: DualGaugeAlert[]
  dutyAlerts: DualGaugeAlert[]
  speedHotRange: MetricHotRange | null
  dutyHotRange: MetricHotRange | null
  speedSeries: SparklinePoint[]
  dutySeries: SparklinePoint[]
  windowMs?: number
  onPressSpeed: () => void
  onPressDuty: () => void
}

export function GaugePair({
  speedValue,
  dutyValue,
  speedMax,
  dutyMax,
  speedAlerts,
  dutyAlerts,
  speedHotRange,
  dutyHotRange,
  speedSeries,
  dutySeries,
  windowMs,
  onPressSpeed,
  onPressDuty,
}: GaugePairProps) {
  const { size, onLayout } = useCanvasSize()
  const cellWidth = Math.max(0, (size.w - SPARKLINE_GAP) / 2)
  const scale = cellWidth / VB_CROP_W
  const gaugeHeight = cellWidth * (VB_CROP_H / VB_CROP_W)
  const sparklinePaths = useMemo(
    () => [
      buildSparklinePaths({
        points: speedSeries,
        width: cellWidth,
        height: SPARKLINE_HEIGHT,
        range: { min: 0, max: speedMax },
        windowMs,
      }),
      buildSparklinePaths({
        points: dutySeries,
        width: cellWidth,
        height: SPARKLINE_HEIGHT,
        range: { min: 0, max: dutyMax },
        windowMs,
      }),
    ],
    [cellWidth, dutyMax, dutySeries, speedMax, speedSeries, windowMs],
  )
  const leftTransform = useMemo(
    () => [
      { translateX: -VB_CROP_LEFT_X * scale },
      { translateY: SPARKLINE_HEIGHT + SPARKLINE_TOP - CROP_TOP * scale },
      { scale },
    ],
    [scale],
  )
  const rightTransform = useMemo(
    () => [
      { translateX: cellWidth + SPARKLINE_GAP - VB_CROP_RIGHT_X * scale },
      { translateY: SPARKLINE_HEIGHT + SPARKLINE_TOP - CROP_TOP * scale },
      { scale },
    ],
    [cellWidth, scale],
  )
  // Bowls the readouts are centered in, in canvas pixels. They used to be
  // percentage-positioned overlay views; the numbers match those percentages.
  const bowlTop = SPARKLINE_HEIGHT + SPARKLINE_TOP + gaugeHeight * 0.1
  const bowl = {
    y: bowlTop,
    width: size.w * 0.4,
    height: size.h - bowlTop - gaugeHeight * 0.05,
  }
  return (
    <View style={styles.gaugePair} onLayout={onLayout}>
      {scale > 0 ? (
        <Canvas style={styles.svg}>
          <Group transform={[{ translateY: SPARKLINE_TOP }]}>
            <SparklineLayer paths={sparklinePaths[0]} color={telemetry.speed.color} showMax />
          </Group>
          <Group
            transform={[{ translateX: cellWidth + SPARKLINE_GAP }, { translateY: SPARKLINE_TOP }]}
          >
            <SparklineLayer paths={sparklinePaths[1]} color={telemetry.duty.color} showMax />
          </Group>
          <QuarterArcLayer
            side="left"
            value={speedValue}
            max={speedMax}
            color={telemetry.speed.color}
            unit="km/h"
            alerts={speedAlerts}
            hotRange={speedHotRange}
            transform={leftTransform}
          />
          <QuarterArcLayer
            side="right"
            value={dutyValue}
            max={dutyMax}
            color={telemetry.duty.color}
            unit="%"
            alerts={dutyAlerts}
            hotRange={dutyHotRange}
            transform={rightTransform}
          />
          <GaugeValueLayer
            value={speedValue}
            color={telemetry.speed.color}
            unit="km/h"
            hotRange={speedHotRange}
            box={{ ...bowl, x: size.w * 0.05 }}
          />
          <GaugeValueLayer
            value={dutyValue}
            color={telemetry.duty.color}
            unit="%"
            hotRange={dutyHotRange}
            box={{ ...bowl, x: size.w * 0.55 }}
          />
        </Canvas>
      ) : null}
      <View
        style={[
          styles.gaugeTouchRow,
          { height: SPARKLINE_TOP + SPARKLINE_HEIGHT + gaugeHeight * ARC_BOTTOM_RATIO },
        ]}
      >
        <Pressable
          style={styles.halfPressable}
          testID="gauge-speed"
          onPress={onPressSpeed}
          android_ripple={interaction.ripple}
        />
        <Pressable
          style={styles.halfPressable}
          testID="gauge-duty"
          onPress={onPressDuty}
          android_ripple={interaction.ripple}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  gaugePair: { width: '100%', aspectRatio: 1.4, position: 'relative' },
  gaugeTouchRow: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', gap: 32 },
  halfPressable: {
    flex: 1,
    overflow: 'visible',
  },
  svg: {
    width: '100%',
    height: '100%',
  },
})
