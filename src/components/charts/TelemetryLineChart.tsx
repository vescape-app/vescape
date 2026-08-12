import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  ChartHeaderReadout,
  ChartTooltipReadout,
  TOOLTIP_WIDTH,
} from '@/components/charts/TelemetryLineChartReadouts'
import { Text } from '@/components/base/Text'
import {
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

export type { ChartTrimConfig } from '@/components/charts/TelemetryChartTrim'

const DEFAULT_HEIGHT = 54
const Y_AXIS_WIDTH = 34
const CARD_HORIZONTAL_PADDING = 8
const EXCLUSION_MARKER_HEIGHT = 1
const EXCLUSION_MARKER_INSET = 1
const ALERT_LINE_COLOR = theme.alpha(theme.palette.yellow.color, 0.1)
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

function exclusionColor(reason: string): string {
  return reason === 'free_spin' ? theme.palette.yellow.color : theme.palette.slate.textSecondary
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
  const plainRuns = useMemo(
    () =>
      !getPointColor && width > 0
        ? splitChartLineSegments(points, range, width, height, windowMs)
        : [],
    [getPointColor, height, points, range, width, windowMs],
  )
  const plainPaths = useMemo(
    () => plainRuns.filter((segment) => segment.length >= 2).map(buildLinePath),
    [plainRuns],
  )
  const gradientRuns = useMemo(
    () =>
      getPointColor && width > 0
        ? splitChartPointSegments(points, range, width, height, windowMs)
        : [],
    [getPointColor, height, points, range, width, windowMs],
  )
  const gradientSegments = useMemo(
    () =>
      gradientRuns
        .filter((segment) => segment.length >= 2)
        .map((segment) => ({
          path: buildLinePath(segment),
          colors: segment.map((point) => getPointColor?.(point.point.value) ?? color),
          positions: segment.map((point) => Math.max(0, Math.min(1, point.x / width))),
        })),
    [color, getPointColor, gradientRuns, width],
  )
  // A stretch sampled slower than the gap threshold is all one-sample runs — no path can be
  // stroked through it. Drawn as dots so sparse telemetry reads as sparse, not as missing.
  const orphanDots = useMemo(
    () =>
      getPointColor
        ? gradientRuns
            .filter((segment) => segment.length === 1)
            .map((segment) => ({ ...segment[0], color: getPointColor(segment[0].point.value) }))
        : plainRuns
            .filter((segment) => segment.length === 1)
            .map((segment) => ({ ...segment[0], color })),
    [color, getPointColor, gradientRuns, plainRuns],
  )

  const dots = orphanDots.map((dot, index) => (
    <Circle key={`dot-${index}`} cx={dot.x} cy={dot.y} r={1.5} color={dot.color} />
  ))

  if (getPointColor) {
    return (
      <>
        {dots}
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
      {dots}
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
  const [chartWidth, setChartWidth] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const internalScrubTimeMs = useSharedValue<number | null>(null)
  const activeScrubTimeMs = scrubTimeMs ?? internalScrubTimeMs
  const currentTimeMs = useSharedValue<number | null>(currentPoint?.date.getTime() ?? null)
  const onPointSelectedRef = useRef(onPointSelected)
  const onGestureStartRef = useRef(onGestureStart)
  const onScrubTimeChangeRef = useRef(onScrubTimeChange)
  // Freeze live series while dragging so path and marker-table rebuilds do not starve JS.
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
        color,
        getPointColor,
        formatValue,
        windowMs,
        secondary: displaySecondary,
      }),
    [
      chartWidth,
      color,
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
  // Only the string is captured: closing over `secondary` would drag its points
  // (and their Date fields) into the worklet, which Reanimated cannot copy.
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
    () => getChartTimeRangeBands(displayPoints, timeRangeHighlights ?? [], chartWidth, windowMs),
    [chartWidth, displayPoints, timeRangeHighlights, windowMs],
  )

  // Header readout: the live marker color wins whenever points carry their own
  // color, otherwise the secondary series color, otherwise the neutral token.
  const headerValueColor = secondary
    ? color
    : getPointColor
      ? markerColor
      : theme.palette.slate.textPrimary
  const hasMarker = markerTable.ts.length > 0

  return (
    <View style={[styles.card, containerStyle]}>
      <ChartHeaderReadout
        label={label}
        showTime={isDragging}
        timeText={liveTimeText}
        valueText={liveValueText}
        valueColor={headerValueColor}
      />

      {isDragging && hasMarker && (
        <ChartTooltipReadout
          style={tooltipAnimatedStyle}
          timeText={liveTimeText}
          valueText={liveValueText}
          valueColor={markerColor}
          secondaryValueText={secondary ? liveSecondaryValueText : undefined}
          secondaryColor={secondary?.color}
        />
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
                  color={theme.palette.slate.surface}
                  strokeWidth={0.5}
                />
                <Line
                  p1={vec(0, height / 2)}
                  p2={vec(chartWidth, height / 2)}
                  color={theme.palette.slate.surface}
                  strokeWidth={0.5}
                >
                  <DashPathEffect intervals={[4, 4]} />
                </Line>
                <Line
                  p1={vec(0, height - 0.5)}
                  p2={vec(chartWidth, height - 0.5)}
                  color={theme.palette.slate.surface}
                  strokeWidth={0.5}
                />

                {alertMarkers.map((marker) => (
                  <Line
                    key={marker.value}
                    p1={vec(0, marker.y)}
                    p2={vec(chartWidth, marker.y)}
                    color={ALERT_LINE_COLOR}
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
                      color={exclusionColor(range.reason)}
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
                  color={color}
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
                    color={theme.palette.slate.textDim}
                    strokeWidth={1}
                  >
                    <DashPathEffect intervals={[3, 3]} />
                  </Line>
                )}

                <Circle cx={markerX} cy={markerY} r={4} color={theme.palette.slate.surfaceDeep} />
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
    color: theme.palette.slate.textDim,
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
    color: theme.palette.slate.textDim,
    fontSize: 8,
    fontVariant: ['tabular-nums'],
  },
  xLabelHidden: {
    opacity: 0,
  },
})
