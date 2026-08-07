import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { AnimatedValueText } from '@/components/base/AnimatedValueText'
import { Text } from '@/components/base/Text'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import {
  Canvas,
  Circle,
  DashPathEffect,
  Line,
  LinearGradient,
  Path,
  Rect,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia'

import { theme } from '@/constants/theme'
import {
  getChartPosition,
  getChartTimeRangeBands,
  getChartTimeLabels,
  getXPosition,
  getChartAlertMarkers,
  getChartExclusionColor,
  splitChartPointSegments,
  splitChartLineSegments,
  type ExcludedRange,
  type ChartTimeMode,
  type TelemetryChartPoint,
} from '@/components/charts/chartMath'
import {
  TelemetryChartTrimOverlay,
  useChartTrim,
  type ChartTrimConfig,
} from '@/components/charts/TelemetryChartTrim'
import {
  useResolvedAccentColors,
  useResolvedColor,
  useResolvedColorItems,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'

export type { ChartTrimConfig } from '@/components/charts/TelemetryChartTrim'

const DEFAULT_HEIGHT = 54
const Y_AXIS_WIDTH = 34
const TOOLTIP_WIDTH = 94
const CARD_HORIZONTAL_PADDING = 8
const EXCLUSION_MARKER_HEIGHT = 1
const EXCLUSION_MARKER_INSET = 1
const NO_ALERT_THRESHOLDS: number[] = []
const EMPTY_MARKER_TABLE: MarkerTable = {
  ts: [],
  xs: [],
  ys: [],
  colors: [],
  valueStrs: [],
  timeStrs: [],
}

interface MarkerTable {
  ts: number[]
  xs: number[]
  ys: number[]
  colors: string[]
  valueStrs: string[]
  timeStrs: string[]
  secondaryValueStrs?: string[]
}

function setSharedValue<T>(shared: SharedValue<T>, value: T) {
  shared.value = value
}

function pickNearestSortedIndex(values: number[], target: number): number {
  'worklet'
  const count = values.length
  if (count === 0) return -1
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const prev = lo - 1
  return Math.abs(values[prev] - target) <= Math.abs(values[lo] - target) ? prev : lo
}

/**
 * Pan runs as a worklet: x → marker index → shared scrub time, no JS in the touch
 * path. JS is only poked at drag start/end, plus per-frame-change when a consumer
 * explicitly asked for onScrubTimeChange (history map seek, throttled by callee).
 */
function createScrubGesture({
  enabled,
  markerTableSV,
  activeScrubTimeMs,
  hasScrubCallback,
  startDrag,
  notifyScrub,
  endDrag,
}: {
  enabled: boolean
  markerTableSV: SharedValue<MarkerTable>
  activeScrubTimeMs: SharedValue<number | null>
  hasScrubCallback: boolean
  startDrag: () => void
  notifyScrub: (timeMs: number) => void
  endDrag: (timeMs: number | null) => void
}) {
  return Gesture.Pan()
    .enabled(enabled)
    .onBegin((event) => {
      'worklet'
      const idx = pickNearestSortedIndex(markerTableSV.value.xs, event.x)
      if (idx < 0) return
      const timeMs = markerTableSV.value.ts[idx]
      activeScrubTimeMs.value = timeMs
      runOnJS(startDrag)()
      if (hasScrubCallback) runOnJS(notifyScrub)(timeMs)
    })
    .onUpdate((event) => {
      'worklet'
      const idx = pickNearestSortedIndex(markerTableSV.value.xs, event.x)
      if (idx < 0) return
      const timeMs = markerTableSV.value.ts[idx]
      if (timeMs === activeScrubTimeMs.value) return
      activeScrubTimeMs.value = timeMs
      if (hasScrubCallback) runOnJS(notifyScrub)(timeMs)
    })
    .onFinalize(() => {
      'worklet'
      const timeMs = activeScrubTimeMs.value
      activeScrubTimeMs.value = null
      runOnJS(endDrag)(timeMs)
    })
}

function formatTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
}

function formatAxisNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100 || Number.isInteger(value)) return Math.round(value).toString()
  return value.toFixed(1)
}

function buildLinePath(coords: { x: number; y: number }[]) {
  const builder = Skia.PathBuilder.Make().moveTo(coords[0].x, coords[0].y)
  for (let i = 1; i < coords.length; i += 1) builder.lineTo(coords[i].x, coords[i].y)
  return builder.detach()
}

function resolveActiveChartColor(
  currentPoint: TelemetryChartPoint | null,
  baseColor: string,
  getPointColor?: (value: number) => string,
): string {
  if (!currentPoint || !getPointColor) return baseColor
  return getPointColor(currentPoint.value)
}

function valueAtTime(points: TelemetryChartPoint[], timeMs: number): TelemetryChartPoint | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDistance = Math.abs(best.date.getTime() - timeMs)
  for (const point of points) {
    const distance = Math.abs(point.date.getTime() - timeMs)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return best
}

function buildMarkerTable({
  points,
  range,
  width,
  height,
  color,
  getPointColor,
  formatValue,
  windowMs,
  secondary,
}: {
  points: TelemetryChartPoint[]
  range: { y: { min: number; max: number } }
  width: number
  height: number
  color: string
  getPointColor?: (value: number) => string
  formatValue?: (value: number) => string
  windowMs?: number
  secondary?: SecondaryChartSeries
}): MarkerTable {
  if (width < 1 || points.length < 1) return EMPTY_MARKER_TABLE
  const table: MarkerTable = {
    ts: [],
    xs: [],
    ys: [],
    colors: [],
    valueStrs: [],
    timeStrs: [],
    secondaryValueStrs: secondary ? [] : undefined,
  }
  for (const point of points) {
    const position = getChartPosition(points, point, range, width, height, windowMs)
    if (!position) continue
    const timeMs = point.date.getTime()
    table.ts.push(timeMs)
    table.xs.push(position.x)
    table.ys.push(position.y)
    table.colors.push(getPointColor ? getPointColor(point.value) : color)
    table.valueStrs.push(formatValue ? formatValue(point.value) : point.value.toFixed(1))
    table.timeStrs.push(formatTime(point.date))
    if (secondary && table.secondaryValueStrs) {
      const secondaryPoint = valueAtTime(secondary.points, timeMs)
      table.secondaryValueStrs.push(
        secondaryPoint
          ? secondary.formatValue
            ? secondary.formatValue(secondaryPoint.value)
            : secondary.value
          : '-',
      )
    }
  }
  return table
}

export interface SecondaryChartSeries {
  points: TelemetryChartPoint[]
  range: { y: { min: number; max: number } }
  color: string
  /** Display value for the current/selected time, shown in the header. */
  value: string
  formatValue?: (value: number) => string
}

export interface ChartTimeRangeHighlight {
  startMs: number
  endMs: number
  color: string
}

interface TelemetryLineChartProps {
  label?: string
  value: string
  points: TelemetryChartPoint[]
  currentPoint: TelemetryChartPoint | null
  color: string
  range: { y: { min: number; max: number } }
  height?: number
  containerStyle?: StyleProp<ViewStyle>
  onPointSelected?: (point: TelemetryChartPoint) => void
  onGestureStart?: () => void
  formatValue?: (value: number) => string
  getPointColor?: (value: number) => string
  windowMs?: number
  /** Live charts count back from now; history charts show local wall-clock endpoints. */
  timeMode?: ChartTimeMode
  excludedRanges?: ExcludedRange[]
  /** Optional second line plotted on a right-side axis with its own range. */
  secondary?: SecondaryChartSeries
  scrubTimeMs?: SharedValue<number | null>
  onScrubTimeChange?: (timeMs: number) => void
  /** Enable scrub gestures even without selection callbacks (live charts). */
  scrubbable?: boolean
  /** Reserve the right-axis gutter so charts with and without a secondary axis align. */
  reserveRightAxis?: boolean
  /** Alert starts and range ceilings drawn as faint horizontal reference lines. */
  alertThresholds?: number[]
  /** When set, the chart is a range trimmer instead of a scrubber. */
  trim?: ChartTrimConfig
  /** Solid translucent bands rendered behind the chart lines. */
  timeRangeHighlights?: ChartTimeRangeHighlight[]
}

interface ChartLineSegmentsProps {
  points: TelemetryChartPoint[]
  range: { y: { min: number; max: number } }
  width: number
  height: number
  color: string
  getPointColor?: (value: number) => string
  windowMs?: number
}

const ChartLineSegments = memo(function ChartLineSegments({
  points,
  range,
  width,
  height,
  color,
  getPointColor,
  windowMs,
}: ChartLineSegmentsProps) {
  const plainPaths = useMemo(
    () =>
      !getPointColor && width > 0
        ? splitChartLineSegments(points, range, width, height, windowMs)
            .filter((segment) => segment.length >= 2)
            .map(buildLinePath)
        : [],
    [getPointColor, height, points, range, width, windowMs],
  )
  const gradientSegments = useMemo(
    () =>
      getPointColor && width > 0
        ? splitChartPointSegments(points, range, width, height, windowMs)
            .filter((segment) => segment.length >= 2)
            .map((segment) => ({
              path: buildLinePath(segment),
              colors: segment.map((point) => getPointColor(point.point.value)),
              positions: segment.map((point) => Math.max(0, Math.min(1, point.x / width))),
            }))
        : [],
    [getPointColor, height, points, range, width, windowMs],
  )

  if (getPointColor) {
    return (
      <>
        {gradientSegments.map((segment, index) => (
          <Path
            key={index}
            path={segment.path}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
          >
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, 0)}
              colors={segment.colors}
              positions={segment.positions}
            />
          </Path>
        ))}
      </>
    )
  }

  return (
    <>
      {plainPaths.map((path, index) => (
        <Path
          key={index}
          path={path}
          color={color}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
        />
      ))}
    </>
  )
})

// TODO: Split chart state derivation to reduce cyclomatic complexity below 30.
// eslint-disable-next-line complexity
export function TelemetryLineChart({
  label,
  value,
  points,
  currentPoint,
  color,
  range,
  height = DEFAULT_HEIGHT,
  containerStyle,
  onPointSelected,
  onGestureStart,
  formatValue,
  getPointColor,
  windowMs,
  timeMode = 'relative',
  excludedRanges,
  secondary,
  scrubTimeMs,
  onScrubTimeChange,
  scrubbable = false,
  reserveRightAxis = false,
  alertThresholds = NO_ALERT_THRESHOLDS,
  trim,
  timeRangeHighlights,
}: TelemetryLineChartProps) {
  'use no memo'
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const resolvedColor = useResolvedColor(color)
  const resolvedTimeRangeHighlights = useResolvedColorItems(timeRangeHighlights)
  const [chartWidth, setChartWidth] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const internalScrubTimeMs = useSharedValue<number | null>(null)
  const activeScrubTimeMs = scrubTimeMs ?? internalScrubTimeMs
  const currentTimeMs = useSharedValue<number | null>(currentPoint?.date.getTime() ?? null)
  const onPointSelectedRef = useRef(onPointSelected)
  const onGestureStartRef = useRef(onGestureStart)
  const onScrubTimeChangeRef = useRef(onScrubTimeChange)
  const liveSeriesRef = useRef({ points, secondary })
  const [frozenSeries, setFrozenSeries] = useState<{
    points: TelemetryChartPoint[]
    secondary?: SecondaryChartSeries
  } | null>(null)
  const displayPoints = frozenSeries?.points ?? points
  const displaySecondary = frozenSeries ? frozenSeries.secondary : secondary

  useEffect(() => {
    onPointSelectedRef.current = onPointSelected
    onGestureStartRef.current = onGestureStart
    onScrubTimeChangeRef.current = onScrubTimeChange
    liveSeriesRef.current = { points, secondary }
  })

  useEffect(() => {
    setSharedValue(currentTimeMs, currentPoint?.date.getTime() ?? null)
  }, [currentPoint, currentTimeMs])

  const onGraphLayout = useCallback((event: LayoutChangeEvent) => {
    setChartWidth(Math.round(event.nativeEvent.layout.width))
  }, [])

  const markerTable = useMemo(
    () =>
      buildMarkerTable({
        points: displayPoints,
        range,
        width: chartWidth,
        height,
        color: resolvedColor,
        getPointColor,
        formatValue,
        windowMs,
        secondary: displaySecondary,
      }),
    [
      chartWidth,
      resolvedColor,
      displayPoints,
      displaySecondary,
      formatValue,
      getPointColor,
      height,
      range,
      windowMs,
    ],
  )
  const markerTableSV = useSharedValue<MarkerTable>(markerTable)

  useEffect(() => {
    setSharedValue(markerTableSV, markerTable)
  }, [markerTable, markerTableSV])

  const liveIdx = useDerivedValue(() => {
    const timeMs = activeScrubTimeMs.value ?? currentTimeMs.value
    return timeMs == null ? -1 : pickNearestSortedIndex(markerTableSV.value.ts, timeMs)
  })
  const markerX = useDerivedValue(() => {
    const idx = liveIdx.value
    return idx >= 0 ? markerTableSV.value.xs[idx] : -100
  })
  const markerY = useDerivedValue(() => {
    const idx = liveIdx.value
    return idx >= 0 ? markerTableSV.value.ys[idx] : -100
  })
  const markerColor = useDerivedValue(() => {
    const idx = liveIdx.value
    return idx >= 0 ? markerTableSV.value.colors[idx] : color
  })
  const markerLineTop = useDerivedValue(() => vec(markerX.value, 0))
  const markerLineBottom = useDerivedValue(() => vec(markerX.value, height))
  const liveValueText = useDerivedValue(() => {
    const idx = liveIdx.value
    return idx >= 0 ? markerTableSV.value.valueStrs[idx] : value
  })
  const liveTimeText = useDerivedValue(() => {
    const idx = liveIdx.value
    return idx >= 0 ? markerTableSV.value.timeStrs[idx] : ''
  })
  // Capture only the string; Reanimated cannot copy the secondary series' Date fields.
  const secondaryFallbackValue = secondary?.value ?? '-'
  const liveSecondaryValueText = useDerivedValue(() => {
    const idx = liveIdx.value
    const values = markerTableSV.value.secondaryValueStrs
    return idx >= 0 && values ? values[idx] : secondaryFallbackValue
  })
  const tooltipAnimatedStyle = useAnimatedStyle(() => {
    const half = TOOLTIP_WIDTH / 2
    const cardChartLeft = CARD_HORIZONTAL_PADDING + Y_AXIS_WIDTH
    const cardChartRight = cardChartLeft + chartWidth
    let left = cardChartLeft + markerX.value - half
    if (left < CARD_HORIZONTAL_PADDING) left = CARD_HORIZONTAL_PADDING
    if (left + TOOLTIP_WIDTH > cardChartRight) left = cardChartRight - TOOLTIP_WIDTH
    return { left }
  })
  const liveValueColorStyle = useAnimatedStyle(() => ({
    color: markerColor.value,
  }))

  // JS-side gesture bookkeeping: one call at drag start (tooltip + freeze) and one at
  // release. The per-move path stays entirely on the UI thread.
  const startDrag = useCallback(() => {
    setIsDragging(true)
    setFrozenSeries(liveSeriesRef.current)
    onGestureStartRef.current?.()
  }, [])
  const notifyScrub = useCallback((timeMs: number) => {
    onScrubTimeChangeRef.current?.(timeMs)
  }, [])
  const endDrag = useCallback((timeMs: number | null) => {
    setIsDragging(false)
    setFrozenSeries(null)
    if (timeMs != null && onPointSelectedRef.current) {
      const point = valueAtTime(liveSeriesRef.current.points, timeMs)
      if (point) onPointSelectedRef.current(point)
    }
  }, [])

  const scrubEnabled =
    !trim &&
    points.length > 0 &&
    chartWidth > 0 &&
    (scrubbable || !!onPointSelected || !!onScrubTimeChange)

  const hasScrubCallback = !!onScrubTimeChange
  const panGesture = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- shared values are only read/written inside gesture worklets, not during render
      createScrubGesture({
        enabled: scrubEnabled,
        markerTableSV,
        activeScrubTimeMs,
        hasScrubCallback,
        startDrag,
        notifyScrub,
        endDrag,
      }),
    [
      activeScrubTimeMs,
      endDrag,
      hasScrubCallback,
      markerTableSV,
      notifyScrub,
      scrubEnabled,
      startDrag,
    ],
  )

  // Trim shares the chart's own time domain: first→last plotted sample maps to [0, chartWidth].
  const trimDomainStartMs = displayPoints[0]?.date.getTime() ?? 0
  const trimDomainEndMs = displayPoints.at(-1)?.date.getTime() ?? 0
  const trimState = useChartTrim({
    trim,
    chartWidth,
    domainStartMs: trimDomainStartMs,
    domainEndMs: trimDomainEndMs,
  })
  const activeGesture = trim ? trimState.gesture : panGesture

  const yMid = (range.y.min + range.y.max) / 2
  const secondaryYMid = secondary ? (secondary.range.y.min + secondary.range.y.max) / 2 : 0
  const alertMarkers = useMemo(
    () => getChartAlertMarkers(alertThresholds, range, height),
    [alertThresholds, height, range],
  )

  const timeLabels = useMemo(() => {
    return getChartTimeLabels(displayPoints, windowMs, timeMode)
  }, [displayPoints, timeMode, windowMs])
  const timeRangeBands = useMemo(
    () => getChartTimeRangeBands(displayPoints, resolvedTimeRangeHighlights, chartWidth, windowMs),
    [chartWidth, displayPoints, resolvedTimeRangeHighlights, windowMs],
  )

  const activeColor = resolveActiveChartColor(currentPoint, resolvedColor, getPointColor)
  const valueColorStyle = getPointColor && currentPoint ? { color: activeColor } : undefined
  const hasMarker = markerTable.ts.length > 0

  return (
    <View style={[styles.card, containerStyle]}>
      <View style={styles.header}>
        {label ? <Text style={styles.label}>{label}</Text> : <View />}
        <View style={styles.headerRight}>
          {isDragging && <AnimatedValueText text={liveTimeText} style={styles.headerTime} />}
          <AnimatedValueText
            text={liveValueText}
            style={[
              styles.value,
              secondary ? { color } : valueColorStyle,
              getPointColor && !secondary ? liveValueColorStyle : undefined,
            ]}
          />
        </View>
      </View>

      {isDragging && hasMarker && (
        <Animated.View style={[styles.tooltip, tooltipAnimatedStyle]}>
          <View style={styles.tooltipValues}>
            <AnimatedValueText
              text={liveValueText}
              style={[styles.tooltipValue, { color: activeColor }, liveValueColorStyle]}
            />
            {secondary && (
              <AnimatedValueText
                text={liveSecondaryValueText}
                style={[styles.tooltipValue, { color: secondary.color }]}
              />
            )}
          </View>
          <AnimatedValueText text={liveTimeText} style={styles.tooltipTime} />
        </Animated.View>
      )}

      <View style={styles.chartBody}>
        <View style={[styles.yAxis, { height }]}>
          <Text style={styles.yLabel}>{formatAxisNumber(range.y.max)}</Text>
          <Text style={styles.yLabel}>{formatAxisNumber(yMid)}</Text>
          <Text style={styles.yLabel}>{formatAxisNumber(range.y.min)}</Text>
        </View>

        <GestureDetector gesture={activeGesture}>
          <View style={[styles.graphWrap, { height }]} onLayout={onGraphLayout}>
            {chartWidth > 0 && (
              <Canvas style={{ width: chartWidth, height }}>
                {timeRangeBands.map((band) => (
                  <Rect
                    key={`${band.startMs}-${band.endMs}-${band.color}`}
                    x={band.x}
                    y={0}
                    width={band.width}
                    height={height}
                    color={band.color}
                  />
                ))}
                <Line
                  p1={vec(0, 0.5)}
                  p2={vec(chartWidth, 0.5)}
                  color={neutral.surface}
                  strokeWidth={0.5}
                />
                <Line
                  p1={vec(0, height / 2)}
                  p2={vec(chartWidth, height / 2)}
                  color={neutral.surface}
                  strokeWidth={0.5}
                >
                  <DashPathEffect intervals={[4, 4]} />
                </Line>
                <Line
                  p1={vec(0, height - 0.5)}
                  p2={vec(chartWidth, height - 0.5)}
                  color={neutral.surface}
                  strokeWidth={0.5}
                />

                {alertMarkers.map((marker) => (
                  <Line
                    key={marker.value}
                    p1={vec(0, marker.y)}
                    p2={vec(chartWidth, marker.y)}
                    color={theme.alpha(accents.yellow.color, 0.3)}
                    strokeWidth={1}
                  />
                ))}

                {excludedRanges?.map((range) => {
                  const x1 = getXPosition(displayPoints, range.startMs, chartWidth, windowMs)
                  const x2 = getXPosition(displayPoints, range.endMs, chartWidth, windowMs)
                  if (x1 == null || x2 == null) return null
                  const bandWidth = Math.max(x2 - x1, 2)
                  return (
                    <RoundedRect
                      key={`${range.reason}-${range.startMs}-${range.endMs}`}
                      x={x1}
                      y={height - EXCLUSION_MARKER_HEIGHT - EXCLUSION_MARKER_INSET}
                      width={bandWidth}
                      height={EXCLUSION_MARKER_HEIGHT}
                      r={0.5}
                      color={getChartExclusionColor(
                        range.reason,
                        neutral.textSecondary,
                        accents.yellow.color,
                      )}
                      opacity={0.85}
                    />
                  )
                })}

                {displaySecondary && (
                  <ChartLineSegments
                    points={displaySecondary.points}
                    range={displaySecondary.range}
                    width={chartWidth}
                    height={height}
                    color={displaySecondary.color}
                    windowMs={windowMs}
                  />
                )}

                <ChartLineSegments
                  points={displayPoints}
                  range={range}
                  width={chartWidth}
                  height={height}
                  color={resolvedColor}
                  getPointColor={getPointColor}
                  windowMs={windowMs}
                />
              </Canvas>
            )}
            {chartWidth > 0 && hasMarker && !trim && (
              <Canvas style={[styles.markerCanvas, { width: chartWidth, height }]}>
                {isDragging && (
                  <Line
                    p1={markerLineTop}
                    p2={markerLineBottom}
                    color={neutral.textDim}
                    strokeWidth={1}
                  >
                    <DashPathEffect intervals={[3, 3]} />
                  </Line>
                )}

                <Circle cx={markerX} cy={markerY} r={4} color={neutral.surfaceDeep} />
                <Circle
                  cx={markerX}
                  cy={markerY}
                  r={4}
                  color={markerColor}
                  style="stroke"
                  strokeWidth={2}
                />
              </Canvas>
            )}
            {trim && chartWidth > 0 && (
              <TelemetryChartTrimOverlay
                height={height}
                chartWidth={chartWidth}
                trimState={trimState}
              />
            )}
          </View>
        </GestureDetector>

        {secondary ? (
          <View style={[styles.rightAxis, { height }]}>
            <Text style={styles.yLabel}>{formatAxisNumber(secondary.range.y.max)}</Text>
            <Text style={styles.yLabel}>{formatAxisNumber(secondaryYMid)}</Text>
            <Text style={styles.yLabel}>{formatAxisNumber(secondary.range.y.min)}</Text>
          </View>
        ) : reserveRightAxis ? (
          <View style={[styles.rightAxis, { height }]} />
        ) : null}
      </View>

      <View
        style={[
          styles.xAxis,
          {
            marginLeft: Y_AXIS_WIDTH,
            marginRight: secondary || reserveRightAxis ? Y_AXIS_WIDTH : 0,
          },
        ]}
      >
        <Text style={[styles.xLabel, !timeLabels && styles.xLabelHidden]}>
          {timeLabels?.start ?? '--'}
        </Text>
        <Text style={[styles.xLabel, !timeLabels && styles.xLabelHidden]}>
          {timeLabels?.end ?? '--'}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    position: 'relative',
    paddingHorizontal: CARD_HORIZONTAL_PADDING,
    paddingTop: 6,
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTime: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: theme.neutral.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: theme.neutral.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chartBody: {
    flexDirection: 'row',
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 4,
    position: 'relative',
  },
  rightAxis: {
    width: Y_AXIS_WIDTH,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingLeft: 4,
  },
  yLabel: {
    color: theme.neutral.textDim,
    fontSize: 8,
    fontVariant: ['tabular-nums'],
    lineHeight: 10,
  },
  graphWrap: {
    flex: 1,
  },
  markerCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  xLabel: {
    color: theme.neutral.textDim,
    fontSize: 8,
    fontVariant: ['tabular-nums'],
  },
  xLabelHidden: {
    opacity: 0,
  },
  tooltip: {
    position: 'absolute',
    top: 2,
    width: TOOLTIP_WIDTH,
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
  },
  tooltipValues: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tooltipValue: {
    color: theme.neutral.textPrimary,
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tooltipTime: {
    color: theme.neutral.textMuted,
    fontSize: 8,
    fontVariant: ['tabular-nums'],
  },
})
