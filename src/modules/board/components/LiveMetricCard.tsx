import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Canvas, Group } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import { CaretRightIcon } from 'phosphor-react-native'

import { MonoReadout } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import {
  useResolvedSecondaryWidgetPressed,
  useResolvedSecondaryWidgetSurface,
} from '@/components/widgets/widgetSurface'
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
/** One reading size on every card, so a glance finds each value the same. */
const VALUE_SIZE = 28
const UNIT_SIZE = 12
const LINE_HEIGHT = 38
/** Room the value and its unit take before the sparkline starts: a whole card, or half of one. */
const READOUT_COLUMN = { single: 108, pair: 96 } as const

export interface LiveMetricLine {
  /** Caption over this line's half of the card. */
  title: string
  /** The metric as presented in the rider's units. */
  metric: ReturnType<typeof presentTelemetryMetric>
  /** Live reading in the metric's base unit, UI thread. */
  value: SharedValue<number | null>
  /** Decimated recent series, oldest first. */
  points: SparklinePoint[]
  /** Opens this line's own detail, splitting a pair into two press targets. Without it the card's
   * `onPress` takes the whole card. */
  onPress?: () => void
}

interface LiveMetricCardProps {
  /** One metric, or a pair (temperatures, footpad sensors, pitch and roll) set side by side, each
   * with its own value and sparkline. */
  lines: LiveMetricLine[]
  /** Span the sparkline covers, so a short history starts partway in instead of stretching. */
  windowMs: number
  /** Extremes over the window, marked on the line and labelled above it: the peak, or for signed
   * readings like currents both ends. Only where they mean something — the rider's limits — not
   * a pack voltage or a tilt. */
  peaks?: 'max' | 'range'
  /** Opens the card's detail, for lines that share one. */
  onPress?: () => void
  /** On the card; split halves take it suffixed with their index. */
  testID?: string
}

/**
 * One live metric as a tappable card: its title, the live reading under it and the recent window
 * as a sparkline, all drawn in one canvas. A pair splits the card in two rather than overlaying two
 * lines, which on noisy signals read as one tangle.
 */
export function LiveMetricCard({ lines, windowMs, peaks, onPress, testID }: LiveMetricCardProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const pressedSurface = useResolvedSecondaryWidgetPressed()
  const [width, setWidth] = useState(0)
  const column = lines.length > 1 ? READOUT_COLUMN.pair : READOUT_COLUMN.single
  const segmentW = (width - PAIR_GAP * (lines.length - 1)) / lines.length
  const sparklineW = Math.max(0, segmentW - column - SPARKLINE_GAP)
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
          height: LINE_HEIGHT,
          minSpan: line.metric.minSpan,
          windowMs,
        }),
      ),
    [lines, sparklineW, windowMs],
  )

  const describe = (index: number) => {
    const ext = extremes[index]
    if (ext == null) return undefined
    return peaks === 'range' ? `min ${ext.min}, max ${ext.max}` : `max ${ext.max}`
  }
  const targets = lines.every((line) => line.onPress)
    ? lines.map((line, index) => ({
        label: line.title,
        hint: describe(index),
        onPress: line.onPress,
      }))
    : [
        {
          label: lines.map((line) => line.title).join(', '),
          hint:
            lines
              .map((_, index) => describe(index))
              .filter(Boolean)
              .join('; ') || undefined,
          onPress,
        },
      ]

  return (
    <View style={[surface, styles.card]} testID={testID}>
      {/* Behind the drawing, so the press highlight shows through: one target for the card, or one
       * per line when each opens its own detail. The drawing is hidden from accessibility; the
       * targets carry its captions and peaks. */}
      <View style={styles.targets}>
        {targets.map((target, index) => (
          <Pressable
            key={target.label}
            style={({ pressed }) => [styles.target, pressed && pressedSurface]}
            onPress={target.onPress}
            accessibilityRole="button"
            accessibilityLabel={target.label}
            accessibilityHint={target.hint}
            testID={targets.length > 1 && testID ? `${testID}-${index}` : undefined}
          />
        ))}
      </View>
      <View
        style={styles.content}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
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
          <View style={styles.line} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 ? (
              <Canvas style={styles.canvas}>
                {lines.map((line, index) => {
                  const x = index * (segmentW + PAIR_GAP)
                  return (
                    <Group key={line.metric.label}>
                      <LineReadout line={line} x={x} width={column} />
                      <Group transform={[{ translateX: x + column + SPARKLINE_GAP }]}>
                        <SparklineLayer
                          paths={paths[index]}
                          color={line.metric.color}
                          showMax={peaks != null}
                          showMin={peaks === 'range'}
                          showLeadIn={false}
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
  width: number
}

function LineReadout({ line, x, width }: LineReadoutProps) {
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
      size={VALUE_SIZE}
      unitSize={UNIT_SIZE}
      color={metric.color}
      align="left"
      x={x}
      y={(LINE_HEIGHT - VALUE_SIZE) / 2}
      width={width}
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
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
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
    height: LINE_HEIGHT,
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
