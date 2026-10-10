import { Circle, Path, Skia } from '@shopify/react-native-skia'

import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

export interface SparklinePoint {
  ts: number
  value: number
}

export interface SparklineRange {
  min: number
  max: number
}

export interface SparklinePathOptions {
  points: SparklinePoint[]
  width: number
  height: number
  range?: SparklineRange
  minSpan?: number
  windowMs?: number
}

export interface SparklinePaths {
  linePath: ReturnType<typeof Skia.Path.Make> | null
  /** Flat stand-in when there is no line to draw: no samples, one, or no spread. */
  baselinePath: ReturnType<typeof Skia.Path.Make> | null
  /** Flat stub across the window before the first sample. */
  leadInPath: ReturnType<typeof Skia.Path.Make> | null
  maxPos: { x: number; y: number } | null
  minPos: { x: number; y: number } | null
}

const SPARKLINE_INSET = 1.5

function makeBaseline(fromX: number, toX: number, y: number) {
  return Skia.PathBuilder.Make().moveTo(fromX, y).lineTo(toX, y).detach()
}

/** A single sample has no line to draw — it becomes a baseline at its own height. */
function singlePointPaths(
  point: SparklinePoint,
  width: number,
  height: number,
  range: SparklinePathOptions['range'],
  minSpan: number,
): SparklinePaths {
  let yMin = range?.min ?? point.value - minSpan / 2
  let yMax = range?.max ?? point.value + minSpan / 2
  if (yMax <= yMin) {
    yMin = point.value - 1
    yMax = point.value + 1
  }
  const t = Math.max(0, Math.min(1, (point.value - yMin) / (yMax - yMin)))
  const y = height - SPARKLINE_INSET - (height - SPARKLINE_INSET * 2) * t
  return {
    linePath: null,
    baselinePath: makeBaseline(0, width, y),
    leadInPath: null,
    maxPos: { x: width, y },
    minPos: { x: width, y },
  }
}

/** The y range the line is drawn in: the caller's, or the data's own padded extent. */
function resolveValueRange(
  points: SparklinePoint[],
  range: SparklinePathOptions['range'],
  minSpan: number,
): { yMin: number; yMax: number } {
  if (range) return { yMin: range.min, yMax: range.max }
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (p.value < yMin) yMin = p.value
    if (p.value > yMax) yMax = p.value
  }
  const span = yMax - yMin
  if (span < minSpan) {
    const mid = (yMax + yMin) / 2
    return { yMin: mid - minSpan / 2, yMax: mid + minSpan / 2 }
  }
  const pad = span * 0.1 || 1
  return { yMin: yMin - pad, yMax: yMax + pad }
}

export function buildSparklinePaths({
  points,
  width,
  height,
  range,
  minSpan = 0,
  windowMs,
}: SparklinePathOptions): SparklinePaths {
  const empty: SparklinePaths = {
    linePath: null,
    baselinePath: null,
    leadInPath: null,
    maxPos: null,
    minPos: null,
  }
  if (width < 1) return empty
  if (points.length === 1) return singlePointPaths(points[0], width, height, range, minSpan)
  if (points.length < 2) return { ...empty, baselinePath: makeBaseline(0, width, height / 2) }

  // Skia draws every point; the live series is already min/max-decimated natively
  // on a stable absolute grid, so no JS re-bucketing (which re-quantised and made
  // the line squiggle on each tick) is needed.
  const xMax = points[points.length - 1].ts
  const xMin = windowMs ? xMax - windowMs : points[0].ts
  const xSpan = xMax - xMin
  const { yMin, yMax } = resolveValueRange(points, range, minSpan)
  const ySpan = yMax - yMin
  if (xSpan <= 0 || ySpan <= 0) {
    return { ...empty, baselinePath: makeBaseline(0, width, height / 2) }
  }

  const project = (p: SparklinePoint) => ({
    x: ((p.ts - xMin) / xSpan) * width,
    y: height - SPARKLINE_INSET - (height - SPARKLINE_INSET * 2) * ((p.value - yMin) / ySpan),
  })
  let maxIndex = 0
  let minIndex = 0
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].value > points[maxIndex].value) maxIndex = i
    if (points[i].value < points[minIndex].value) minIndex = i
  }
  const first = project(points[0])
  const builder = Skia.PathBuilder.Make().moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i += 1) {
    const point = project(points[i])
    builder.lineTo(point.x, point.y)
  }
  return {
    linePath: builder.detach(),
    baselinePath: null,
    leadInPath: first.x > 0 ? makeBaseline(0, first.x, first.y) : null,
    maxPos: project(points[maxIndex]),
    minPos: project(points[minIndex]),
  }
}

interface SparklineLayerProps {
  paths: SparklinePaths
  color: ThemeColor
  showMax?: boolean
  showMin?: boolean
  /** Draw `leadInPath`; off where an empty stretch reads better than a flat line. */
  showLeadIn?: boolean
}

/** Draw-only layer. Parent owns Canvas, so many lines share one GPU surface. */
export function SparklineLayer({
  paths,
  color,
  showMax = false,
  showMin = false,
  showLeadIn = true,
}: SparklineLayerProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedColor = useResolvedColor(color)
  const flatPath = paths.baselinePath ?? (showLeadIn ? paths.leadInPath : null)
  return (
    <>
      {flatPath ? (
        <Path
          path={flatPath}
          color={theme.palette.slate.border}
          style="stroke"
          strokeWidth={1}
          strokeCap="round"
        />
      ) : null}
      {paths.linePath ? (
        <Path
          path={paths.linePath}
          color={resolvedColor}
          style="stroke"
          strokeWidth={1.5}
          strokeCap="round"
          strokeJoin="round"
        />
      ) : null}
      {showMax && paths.maxPos ? (
        <PeakDot pos={paths.maxPos} color={resolvedColor} ring={neutral.surfaceDeep} />
      ) : null}
      {showMin && paths.minPos ? (
        <PeakDot pos={paths.minPos} color={resolvedColor} ring={neutral.surfaceDeep} />
      ) : null}
    </>
  )
}

function PeakDot({
  pos,
  color,
  ring,
}: {
  pos: { x: number; y: number }
  color: string
  ring: string
}) {
  return (
    <>
      <Circle cx={pos.x} cy={pos.y} r={2.5} color={color} />
      <Circle cx={pos.x} cy={pos.y} r={2.5} color={ring} style="stroke" strokeWidth={1} />
    </>
  )
}
