import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Canvas, Group } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { CaretRightIcon } from 'phosphor-react-native'

import { MonoReadout } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import {
  buildSparklinePaths,
  SparklineLayer,
  type SparklinePoint,
} from '@/components/charts/SparklineLayer'
import { interaction, theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import type { presentTelemetryMetric } from '@/modules/board/constants/telemetry'

const LINE_HEIGHT = 30
/** Between a value and its sparkline. */
const SPARKLINE_GAP = 8
/** Between the two halves of a pair. */
const PAIR_GAP = 16
/** Value box, unit and the column they take, before the sparkline starts. */
const READOUT = {
  single: { size: 18, unitSize: 10, width: 60, column: 128 },
  pair: { size: 13, unitSize: 9, width: 42, column: 58 },
} as const

export interface LiveMetricLine {
  /** The metric as presented in the rider's units. */
  metric: ReturnType<typeof presentTelemetryMetric>
  /** Live reading in the metric's base unit, UI thread. */
  value: SharedValue<number | null>
  /** Decimated recent series, oldest first. */
  points: SparklinePoint[]
}

interface LiveMetricRowProps {
  title: string
  /** One metric, or a pair (footpad sensors, pitch and roll) set side by side, each with its own
   * value and sparkline. */
  lines: LiveMetricLine[]
  /** Span the sparkline covers, so a short history starts partway in instead of stretching. */
  windowMs: number
  onPress?: () => void
  testID?: string
}

/**
 * One live metric as a list row: its title, the live reading and the recent window as a sparkline,
 * all drawn in one canvas. A pair splits the row in two rather than overlaying two lines, which on
 * noisy signals read as one tangle.
 */
export function LiveMetricRow({ title, lines, windowMs, onPress, testID }: LiveMetricRowProps) {
  const [width, setWidth] = useState(0)
  const readout = lines.length > 1 ? READOUT.pair : READOUT.single
  const segmentW = (width - PAIR_GAP * (lines.length - 1)) / lines.length
  const sparklineW = Math.max(0, segmentW - readout.column - SPARKLINE_GAP)
  const paths = useMemo(
    () =>
      lines.map((line) =>
        buildSparklinePaths({
          points: line.points,
          width: sparklineW,
          height: LINE_HEIGHT,
          minSpan: line.metric.minSpan,
          windowMs,
        }),
      ),
    [lines, sparklineW, windowMs],
  )

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      android_ripple={interaction.ripple}
      onPress={onPress}
      testID={testID}
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.line} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Canvas style={styles.canvas}>
              {lines.map((line, index) => {
                const x = index * (segmentW + PAIR_GAP)
                return (
                  <Group key={line.metric.label}>
                    <LineReadout line={line} end={x + readout.width} readout={readout} />
                    <Group transform={[{ translateX: x + readout.column + SPARKLINE_GAP }]}>
                      <SparklineLayer paths={paths[index]} color={line.metric.color} />
                    </Group>
                  </Group>
                )
              })}
            </Canvas>
          ) : null}
        </View>
      </View>
      <CaretRightIcon size={14} color={theme.neutral.textMuted} style={styles.caret} />
    </Pressable>
  )
}

interface LineReadoutProps {
  line: LiveMetricLine
  end: number
  readout: (typeof READOUT)[keyof typeof READOUT]
}

function LineReadout({ line, end, readout }: LineReadoutProps) {
  const { value, metric } = line
  const { decimals, displayScale, unit } = metric
  // Runs every tick, but an unchanged string stops there: the unit and the glyphs only redraw when
  // the reading changes at display resolution.
  const text = useDerivedValue(() => {
    const v = value.value
    return v == null ? DASH : (v * displayScale).toFixed(decimals)
  })
  const unitText = useDerivedValue(() => (text.value === DASH ? '' : unit))
  return (
    <MonoReadout
      text={text}
      unit={unitText}
      size={readout.size}
      unitSize={readout.unitSize}
      color={metric.color}
      end={end}
      y={(LINE_HEIGHT - readout.size) / 2}
      width={readout.width}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.neutral.textDim,
  },
  pressed: {
    opacity: interaction.pressedOpacity,
  },
  body: {
    flex: 1,
  },
  title: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  line: {
    height: LINE_HEIGHT,
    marginTop: 2,
  },
  canvas: {
    width: '100%',
    height: '100%',
  },
  caret: {
    marginLeft: 8,
  },
})
