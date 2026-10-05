import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Canvas, Group, Path, Text as SkiaText } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { MonoText } from '@/components/base/MonoValue'
import { interaction, theme, type AlphaLevel } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import {
  useResolvedAccentColors,
  useResolvedColor,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'
import {
  arcPath,
  normalizeFraction,
  STROKE,
  svgPath,
  wedgePath,
  type Arc,
} from '@/modules/board/components/gauge/arcGeometry'
import {
  AlertMarker,
  gaugeRampColor,
  GlowGradient,
} from '@/modules/board/components/gauge/gaugeShared'
import { RIM_TEMP_RANGE, type TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import { useMetricGaugeDecor } from '@/modules/board/hooks/useMetricGaugeDecor'

/**
 * Arc space: a quarter circle in a `UNIT` square, scaled to the drawn radius. Line weights, ticks
 * and alert marks are sized in this space so they match the speed/duty arcs at phone scale.
 */
const UNIT = 36
const ARC_R = UNIT - STROKE / 2
// Both arcs start at the bottom, next to the battery line, and climb to the vertical at the top.
const LEFT_ARC: Arc = { cx: UNIT, cy: 0, r: ARC_R, from: -Math.PI / 2, to: -Math.PI }
const RIGHT_ARC: Arc = { cx: 0, cy: 0, r: ARC_R, from: -Math.PI / 2, to: 0 }
const BG_ARC_LEFT = svgPath(arcPath(LEFT_ARC, 1))
const BG_ARC_RIGHT = svgPath(arcPath(RIGHT_ARC, 1))
const GLOW_STOPS = [0, 0.6, 0.95, 1]
const GLOW_OPACITIES: AlphaLevel[] = [0, 0, 0.12, 0.3]

const VALUE_SIZE = 16
/** Small unit after the value, the way the battery readout sets its `%`. */
const UNIT_SIZE = 9
const UNIT_GAP = 1
/** Readout centre as a share of the radius, measured from the arc's open (inner) side. */
const VALUE_X = 0.27
const VALUE_Y = 0.28
const VALUE_BOX_W = 44
/** Where the value ends, right of the readout centre, so value + unit sit centred together. */
const VALUE_END_OFFSET = 6
/** Gap under the arc to the footer line; the battery bar's aux row lands at the same height. */
const FOOTER_GAP = 2

interface RimTempArcProps {
  side: 'left' | 'right'
  label: string
  metric: TelemetryMetricConfig
  /** Live reading, UI thread. */
  value: SharedValue<number | null>
  /** Drawn radius; the arc fills a square of this size. */
  radius: number
  onPress?: () => void
  testID?: string
}

/**
 * A temperature as a quarter arc rising out of the battery line, the phone's take on the watch rim:
 * it fills from the bottom corner up toward the vertical over the watch's temperature scale.
 */
export function RimTempArc({
  side,
  label,
  metric,
  value,
  radius,
  onPress,
  testID,
}: RimTempArcProps) {
  'use no memo'
  const isLeft = side === 'left'
  const arc = isLeft ? LEFT_ARC : RIGHT_ARC
  const { min, max } = RIM_TEMP_RANGE
  const { alerts, hotRange } = useMetricGaugeDecor(metric)
  const color = useResolvedColor(metric.color)
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const scale = radius / UNIT

  const fraction = useDerivedValue(() => normalizeFraction(value.value ?? min, min, max))
  const valuePath = useDerivedValue(() => svgPath(arcPath(arc, fraction.value)))
  const wedge = useDerivedValue(() => svgPath(wedgePath(arc, fraction.value)))
  const arcColor = useDerivedValue(() =>
    gaugeRampColor(value.value, color, hotRange, accents.red.color),
  )
  const valueText = useDerivedValue(() => {
    const v = value.value
    return v == null || !Number.isFinite(v) ? DASH : Math.round(v).toString()
  })
  const valueColor = useDerivedValue(() => (value.value == null ? neutral.textDim : arcColor.value))

  const valueCenterX = isLeft ? radius * (1 - VALUE_X) : radius * VALUE_X
  const valueEnd = valueCenterX + VALUE_END_OFFSET
  const valueTop = radius * VALUE_Y - VALUE_SIZE / 2
  const valueFont = useSkiaMonoFont('800', VALUE_SIZE)
  const unitFont = useSkiaMonoFont('500', UNIT_SIZE)
  // Shares the value's baseline, matching how MonoText centres its glyphs in the box.
  const unitBaseline = useMemo(() => {
    if (!valueFont) return 0
    const { ascent, descent } = valueFont.getMetrics()
    return valueTop + VALUE_SIZE / 2 - (ascent + descent) / 2
  }, [valueFont, valueTop])

  return (
    <Pressable
      style={({ pressed }) => [pressed && styles.pressed]}
      android_ripple={interaction.rippleBorderless}
      onPress={onPress}
      testID={testID}
    >
      <View style={{ width: radius, height: radius }}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={[{ scale }]}>
            <Path path={wedge}>
              <GlowGradient arc={arc} color={color} stops={GLOW_STOPS} opacities={GLOW_OPACITIES} />
            </Path>
            <Path
              path={isLeft ? BG_ARC_LEFT : BG_ARC_RIGHT}
              color={theme.palette.slate.border}
              style="stroke"
              strokeWidth={STROKE}
              strokeCap="butt"
            />
            <Path
              path={valuePath}
              color={arcColor}
              style="stroke"
              strokeWidth={STROKE}
              strokeCap="butt"
            />
            {alerts.map((alert) => (
              <AlertMarker key={alert.id} arc={arc} alert={alert} min={min} max={max} />
            ))}
          </Group>
          <MonoText
            text={valueText}
            size={VALUE_SIZE}
            weight="800"
            color={valueColor}
            align="right"
            x={valueEnd - VALUE_BOX_W}
            y={valueTop}
            width={VALUE_BOX_W}
            height={VALUE_SIZE}
          />
          {unitFont ? (
            <SkiaText
              x={valueEnd + UNIT_GAP}
              y={unitBaseline}
              text="°C"
              font={unitFont}
              color={valueColor}
            />
          ) : null}
        </Canvas>
      </View>
      {/* Footer line, level with the battery's voltage, set against the battery side. */}
      <Text style={[styles.label, { textAlign: isLeft ? 'right' : 'left' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressed: {
    opacity: interaction.pressedOpacity,
  },
  // Matches the battery's aux footer (LinearGauge `auxText`), offset to the same line under the bar.
  label: {
    marginTop: FOOTER_GAP,
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
})
