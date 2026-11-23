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

const SPARKLINE_GAP = 8
const PAIR_GAP = 16
const VALUE_SIZE = 28
const UNIT_SIZE = 12
const LINE_HEIGHT = 38
const READOUT_COLUMN = { single: 108, pair: 96 } as const

export interface LiveMetricLine {
  title: string
  metric: ReturnType<typeof presentTelemetryMetric>
  value: SharedValue<number | null>
  points: SparklinePoint[]
  onPress?: () => void
}

interface LiveMetricCardProps {
  lines: LiveMetricLine[]
  windowMs: number
  peaks?: 'max' | 'range'
  onPress?: () => void
  testID?: string
}

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

function lineExtremes({ points, metric }: LiveMetricLine): { min: string; max: string } | null {
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    min = Math.min(min, point.value)
    max = Math.max(max, point.value)
  }
  const format = (value: number) =>
    `${(value * metric.displayScale + metric.displayOffset).toFixed(metric.decimals)}${metric.unit}`
  return { min: format(min), max: format(max) }
}

interface LineReadoutProps {
  line: LiveMetricLine
  x: number
  width: number
}

function LineReadout({ line, x, width }: LineReadoutProps) {
  const { value, metric } = line
  const { decimals, displayScale, displayOffset, unit } = metric
  const text = useDerivedValue(() => {
    const v = value.value
    return v == null ? DASH : (v * displayScale + displayOffset).toFixed(decimals)
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
