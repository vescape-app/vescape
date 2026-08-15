import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { Canvas, Group, Path } from '@shopify/react-native-skia'

import { Text } from '@/components/base/Text'
import { type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { theme, type AlphaLevel } from '@/constants/theme'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import {
  useResolvedAccentColors,
  useResolvedColor,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'
import { type MetricHotRange } from '@/modules/history/lib/metricColorScale'
import {
  arcPath,
  normalizeFraction,
  radialTickPath,
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
  LABEL_FONT_SIZE,
} from '@/modules/board/components/gauge/gaugeShared'
import { useCanvasSize } from '@/hooks/useCanvasSize'

interface SingleGaugeProps {
  value: SharedValue<number | null>
  min?: number
  max: number
  color: string
  unit: string
  decimals?: number
  label?: string
  /** Optional action aligned with the gauge label in the chart's top-right corner. */
  headerRight?: ReactNode
  alerts?: DualGaugeAlert[]
  hotRange?: MetricHotRange | null
  /** Draw the live needle + numeric readout. Off for static, offline previews. */
  showValue?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

// Half-arc geometry: sweeps π (f=0) → 0 (f=1) around a center near the bottom.
const HALF_ARC: Arc = { cx: 100, cy: 100, r: 88, from: Math.PI, to: 0 }
const HALF_VB_W = 200
const HALF_VB_H = 112
const MARKER_INSET = 10
const GLOW_STOPS = [0, 0.58, 0.94, 1]
const GLOW_OPACITIES: AlphaLevel[] = [0, 0, 0.12, 0.3]

const BG_ARC = svgPath(arcPath(HALF_ARC, 1))

// Readout box: explicit line height keeps the drawn value at the vertical
// footprint the readout view used to reserve.
const HALF_VALUE_FONT_SIZE = 52
const HALF_VALUE_LINE_HEIGHT = 58
const HALF_UNIT_FONT_SIZE = 12

function HalfArc({
  value,
  min,
  max,
  color,
  unit,
  decimals = 0,
  alerts = [],
  hotRange,
  showValue = true,
}: Required<Pick<SingleGaugeProps, 'value' | 'min' | 'max' | 'color' | 'unit'>> &
  Pick<SingleGaugeProps, 'decimals' | 'alerts' | 'hotRange' | 'showValue'>) {
  const resolvedColor = useResolvedColor(color)
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const { size, onLayout } = useCanvasSize()
  const scale = size.w > 0 ? size.w / HALF_VB_W : 0
  const labelFont = useSkiaFont('700', LABEL_FONT_SIZE)

  const valueText = useDerivedValue(() => {
    const current = value.value
    if (current == null) return '—'
    return decimals === 0 ? Math.round(current).toString() : current.toFixed(decimals)
  })

  const arc = useDerivedValue(() =>
    svgPath(arcPath(HALF_ARC, normalizeFraction(value.value ?? min, min, max))),
  )
  const arcColor = useDerivedValue(() =>
    gaugeRampColor(value.value ?? min, resolvedColor, hotRange, accents.red.color),
  )
  const wedge = useDerivedValue(() =>
    svgPath(wedgePath(HALF_ARC, normalizeFraction(value.value ?? min, min, max))),
  )
  const markerPath = useDerivedValue(() => {
    // No live value → no needle: a zero-position needle next to a "—" readout reads as a real 0.
    if (value.value == null) return svgPath('')
    return radialTickPath(HALF_ARC, normalizeFraction(value.value, min, max), MARKER_INSET)
  })

  const valueColor = useDerivedValue(() =>
    gaugeRampColor(value.value, resolvedColor, hotRange, accents.red.color),
  )

  return (
    <View style={styles.halfWrap}>
      <View style={styles.svg} onLayout={onLayout}>
        {scale > 0 ? (
          <Canvas style={styles.svg}>
            <Group transform={[{ scale }]}>
              <Path path={wedge}>
                <GlowGradient
                  arc={HALF_ARC}
                  color={resolvedColor}
                  stops={GLOW_STOPS}
                  opacities={GLOW_OPACITIES}
                />
              </Path>
              <Path
                path={BG_ARC}
                color={neutral.border}
                style="stroke"
                strokeWidth={STROKE}
                strokeCap="butt"
              />
              <Path
                path={arc}
                color={arcColor}
                style="stroke"
                strokeWidth={STROKE}
                strokeCap="butt"
              />
              {alerts.map((alert) => (
                <AlertMarker
                  key={alert.id}
                  arc={HALF_ARC}
                  alert={alert}
                  min={min}
                  max={max}
                  labelFont={labelFont}
                />
              ))}
              {showValue ? (
                <Path
                  path={markerPath}
                  color={arcColor}
                  style="stroke"
                  strokeWidth={1.7}
                  strokeCap="butt"
                />
              ) : null}
            </Group>
            {showValue ? (
              <GaugeReadout
                text={valueText}
                color={valueColor}
                unit={unit}
                box={{
                  x: size.w * 0.18,
                  y: size.h * 0.36,
                  width: size.w * 0.64,
                  height: size.h * 0.6,
                }}
                valueSize={HALF_VALUE_FONT_SIZE}
                valueLineHeight={HALF_VALUE_LINE_HEIGHT}
                unitSize={HALF_UNIT_FONT_SIZE}
              />
            ) : null}
          </Canvas>
        ) : null}
      </View>
    </View>
  )
}

export function SingleGauge({
  value,
  min = 0,
  max,
  color,
  unit,
  decimals,
  label,
  headerRight,
  alerts = [],
  hotRange,
  showValue = true,
  containerStyle,
}: SingleGaugeProps) {
  return (
    <View style={[styles.singleWrap, containerStyle]}>
      {label || headerRight ? (
        <View style={styles.singleHeader}>
          {label ? <Text style={styles.singleLabel}>{label}</Text> : <View />}
          {headerRight}
        </View>
      ) : null}
      <HalfArc
        value={value}
        min={min}
        max={max}
        color={color}
        unit={unit}
        decimals={decimals}
        alerts={alerts}
        hotRange={hotRange}
        showValue={showValue}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  halfWrap: {
    width: '100%',
    aspectRatio: HALF_VB_W / HALF_VB_H,
    position: 'relative',
  },
  svg: {
    width: '100%',
    height: '100%',
  },
  singleWrap: {
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    overflow: 'hidden',
  },
  singleLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  singleHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
})
