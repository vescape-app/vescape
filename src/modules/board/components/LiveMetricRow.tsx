import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Canvas, Group } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { CaretRightIcon } from 'phosphor-react-native'

import { MonoReadout } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import {
  buildSparklinePaths,
  SparklineLayer,
  type SparklinePoint,
} from '@/components/charts/SparklineLayer'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import type { presentTelemetryMetric } from '@/modules/board/constants/telemetry'

/** Between a value and its sparkline. */
const SPARKLINE_GAP = 8
/** Between the two halves of a pair. */
const PAIR_GAP = 16
/** Value size, unit size, the column the value and unit take before the sparkline starts, and the
 * height of the line they share. */
const READOUT = {
  large: { size: 28, unitSize: 12, column: 108, height: 38 },
  single: { size: 20, unitSize: 10, column: 84, height: 30 },
  pair: { size: 14, unitSize: 9, column: 60, height: 30 },
} as const

export interface LiveMetricLine {
  /** Caption over this line's half of the row. */
  title: string
  /** The metric as presented in the rider's units. */
  metric: ReturnType<typeof presentTelemetryMetric>
  /** Live reading in the metric's base unit, UI thread. */
  value: SharedValue<number | null>
  /** Decimated recent series, oldest first. */
  points: SparklinePoint[]
  /** Opens this line's detail; a pair's halves are tapped apart. */
  onPress: () => void
}

interface LiveMetricRowProps {
  /** One metric, or a pair (temperatures, footpad sensors, pitch and roll) set side by side, each
   * with its own value and sparkline. */
  lines: LiveMetricLine[]
  /** Span the sparkline covers, so a short history starts partway in instead of stretching. */
  windowMs: number
  /** Extremes over the window, marked on the line and labelled above it: the peak, or for signed
   * readings like currents both ends. Only where they mean something — the rider's limits — not
   * a pack voltage or a tilt. */
  peaks?: 'max' | 'range'
  /** A bigger reading, for the metrics a rider watches most. Single lines only. */
  large?: boolean
  testID?: string
}

/**
 * One live metric as a tappable card: its title, the live reading under it and the recent window
 * as a sparkline, all drawn in one canvas. A pair splits the card in two rather than overlaying two
 * lines, which on noisy signals read as one tangle.
 */
export function LiveMetricRow({ lines, windowMs, peaks, large, testID }: LiveMetricRowProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const [width, setWidth] = useState(0)
  const readout = lines.length > 1 ? READOUT.pair : large ? READOUT.large : READOUT.single
  const segmentW = (width - PAIR_GAP * (lines.length - 1)) / lines.length
  const sparklineW = Math.max(0, segmentW - readout.column - SPARKLINE_GAP)
  const extremes = useMemo(
    () => lines.map((line) => (peaks ? lineExtremes(line) : null)),
    [lines, peaks],
  )
  const paths = useMemo(
    () =>
      lines.map((line) =>
        buildSparklinePaths({
          points: line.points,
          width: sparklineW,
          height: readout.height,
          minSpan: line.metric.minSpan,
          windowMs,
        }),
      ),
    [lines, readout.height, sparklineW, windowMs],
  )

  return (
    <View style={[surface, styles.card]} testID={testID}>
      {/* Behind the drawing, one press target per line, so the press highlight shows through. */}
      <View style={styles.targets}>
        {lines.map((line) => (
          <Pressable
            key={line.metric.label}
            style={({ pressed }) => [styles.target, pressed && styles.pressed]}
            onPress={line.onPress}
            accessibilityRole="button"
            accessibilityLabel={line.title}
          />
        ))}
      </View>
      <View style={styles.row} pointerEvents="none">
        <View style={styles.body}>
          {/* Split like the canvas below: each caption and peak sits over its own sparkline. */}
          <View style={styles.titleRow}>
            {lines.map((line, index) => (
              <View key={line.metric.label} style={styles.titleSegment}>
                <Text style={styles.title} numberOfLines={1}>
                  {line.title}
                </Text>
                {extremes[index] == null ? null : (
                  <Text style={styles.peakLabel} numberOfLines={1}>
                    {peaks === 'range' ? (
                      <>
                        min{' '}
                        <Text style={[styles.peak, { color: line.metric.color }]}>
                          {extremes[index].min}
                        </Text>
                        {'  '}
                      </>
                    ) : null}
                    max{' '}
                    <Text style={[styles.peak, { color: line.metric.color }]}>
                      {extremes[index].max}
                    </Text>
                  </Text>
                )}
              </View>
            ))}
          </View>
          <View
            style={[styles.line, { height: readout.height }]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          >
            {width > 0 ? (
              <Canvas style={styles.canvas}>
                {lines.map((line, index) => {
                  const x = index * (segmentW + PAIR_GAP)
                  return (
                    <Group key={line.metric.label}>
                      <LineReadout line={line} x={x} readout={readout} />
                      <Group transform={[{ translateX: x + readout.column + SPARKLINE_GAP }]}>
                        <SparklineLayer
                          paths={paths[index]}
                          color={line.metric.color}
                          showMax={peaks != null}
                          showMin={peaks === 'range'}
                          showBaseline={false}
                        />
                      </Group>
                    </Group>
                  )
                })}
              </Canvas>
            ) : null}
          </View>
        </View>
        <CaretRightIcon size={14} color={theme.neutral.textMuted} style={styles.caret} />
      </View>
    </View>
  )
}

/** Lowest and highest reading over the window in the rider's units, or null before the first
 * sample. */
function lineExtremes({ points, metric }: LiveMetricLine): { min: string; max: string } | null {
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    min = Math.min(min, point.value)
    max = Math.max(max, point.value)
  }
  const format = (value: number) =>
    `${(value * metric.displayScale).toFixed(metric.decimals)}${metric.unit}`
  return { min: format(min), max: format(max) }
}

interface LineReadoutProps {
  line: LiveMetricLine
  x: number
  readout: (typeof READOUT)[keyof typeof READOUT]
}

function LineReadout({ line, x, readout }: LineReadoutProps) {
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
      align="left"
      x={x}
      y={(readout.height - readout.size) / 2}
      width={readout.column}
    />
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  targets: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  target: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
  },
  pressed: {
    backgroundColor: theme.neutral.surface,
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    gap: PAIR_GAP,
  },
  titleSegment: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  peakLabel: {
    color: theme.neutral.textDim,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  peak: {
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    flexShrink: 1,
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  line: {
    marginTop: 4,
  },
  canvas: {
    width: '100%',
    height: '100%',
  },
  caret: {
    marginLeft: 8,
  },
})
