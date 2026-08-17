import { Circle, Group, Rect, RoundedRect, Text } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { AXIS_FONT_SIZE } from '@/components/charts/line/chartLayout'
import { formatClock } from '@/components/charts/line/chartFormat'
import { projectX, projectY, viewportFor } from '@/components/charts/line/projection'
import { sampleAtSec, type SeriesPaths } from '@/components/charts/line/seriesPaths'
import { toChartMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera, ChartPlotBox, ChartYRange } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'

const CURSOR_COLOR = theme.palette.slate.border
const BANNER_BG = theme.alpha(theme.palette.slate.surfaceDeep, 0.85)
const BANNER_BORDER = theme.palette.slate.surface
export const SCRUB_FONT_SIZE = 11
const FONT_SIZE = SCRUB_FONT_SIZE
const ROW_HEIGHT = FONT_SIZE + 4
const PADDING = 5
const RADIUS = 5
/** Clearance between the cursor and the banner, so the line stays readable beside it. */
const BANNER_OFFSET = 8
const DOT_RADIUS = 3
/** Parked off-canvas rather than hidden, so a dot with no sample costs nothing to skip. */
const OFFSCREEN = -1_000

export interface ScrubTarget {
  paths: SeriesPaths
  color: string
  label?: string
  unit?: string
  decimals?: number
  range: ChartYRange
}

export interface ScrubLayerProps {
  targets: ScrubTarget[]
  plot: ChartPlotBox
  /** This chart's position in the stack readout. */
  index: number
  readout: SharedValue<StackReadout>
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
}

/** One chart's share of a frame's readout, in that chart's plot coordinates. */
interface ChartReadout {
  /** Banner origin, and its measured width. */
  x: number
  width: number
  rows: string[]
  /** Flat `[x, y, ...]` per target. */
  dots: number[]
}

/**
 * Everything every chart of the stack needs for one frame, from one worklet.
 *
 * Held together rather than split across a value per chart or per node, for three reasons.
 * Which side of the cursor the banners sit on is a decision for the stack — a banner that flips
 * on its own while its neighbours stay put is the distracting part — and that can only be
 * decided where every chart's width is known. Reanimated schedules each derived value on its
 * own, so separate ones can disagree for a frame: a dot beside a number belonging to the moment
 * before. And the cost that matters while scrubbing is the number of mappers, not the work
 * inside them.
 */
export interface StackReadout {
  time: string
  /** Cursor x in plot coordinates, shared with the bottom time readout. */
  cursorX: number
  charts: ChartReadout[]
}

const EMPTY_CHART_READOUT: ChartReadout = { x: 0, width: 0, rows: [], dots: [] }
const EMPTY_READOUT: StackReadout = { time: '', cursorX: OFFSCREEN, charts: [] }

export interface ScrubChartSpec {
  targets: ScrubTarget[]
  plot: ChartPlotBox
}

export interface ScrubReadoutOptions {
  charts: ScrubChartSpec[]
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  scrubTimeMs: SharedValue<number | null>
  /** Cuts the plot draws through — the cursor is a real moment, the plot is compacted time. */
  timeline: ChartTimeline | null
  /** Width of one mono glyph, measured once on the JS thread. */
  glyphWidth: number
}

/**
 * Sample every series and lay out every banner, once per frame.
 *
 * Text is measured by glyph count rather than shaped: the font is monospaced, so one glyph
 * measured on the JS thread stands in for every label, and no shaping happens while a finger is
 * moving.
 */
export function useScrubReadout({
  charts,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  scrubTimeMs,
  timeline,
  glyphWidth,
}: ScrubReadoutOptions): SharedValue<StackReadout> {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  return useDerivedValue<StackReadout>(() => {
    const timeMs = scrubTimeMs.value
    if (timeMs == null) return EMPTY_READOUT

    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    // The reading is of a real moment; the plot it is drawn on runs in compacted time.
    const chartMs = toChartMs(timeMs, timeline)
    const time = formatClock(timeMs, true)

    // The stack shares one x scale, so the cursor sits at the same place in every plot.
    const plotWidth = charts.length > 0 ? charts[0].plot.width : 0
    const cursorX = projectX(chartMs, viewport, plotWidth)

    const measured: ChartReadout[] = []
    let widest = 0

    for (let c = 0; c < charts.length; c += 1) {
      const { targets, plot } = charts[c]

      const rows: string[] = []
      const dots: number[] = []
      let longest = 0

      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i]
        const { paths } = target
        const sample = sampleAtSec(paths.raw, (chartMs - paths.domainStartMs) / 1000)
        if (!sample.found) {
          rows.push('—')
          longest = Math.max(longest, 1)
          dots.push(OFFSCREEN, OFFSCREEN)
          continue
        }

        const decimals = target.decimals ?? 1
        const formatted =
          decimals === 0 ? Math.round(sample.value).toString() : sample.value.toFixed(decimals)
        const unit = target.unit ? ` ${target.unit}` : ''
        const value = `${formatted}${unit}`
        const row = target.label ? `${target.label} ${value}` : value
        rows.push(row)
        longest = Math.max(longest, row.length)
        dots.push(
          projectX(paths.domainStartMs + sample.sec * 1000, viewport, plot.width),
          projectY(sample.value, target.range, plot.height),
        )
      }

      const width = longest * glyphWidth + PADDING * 2
      widest = Math.max(widest, width)
      measured.push({ x: 0, width, rows, dots })
    }

    // One side for the whole stack: the banners move together, and they move only when the
    // widest of them would otherwise run off the plot.
    const onRight = cursorX + BANNER_OFFSET + widest <= plotWidth
    for (let c = 0; c < measured.length; c += 1) {
      const { width } = measured[c]
      const x = onRight ? cursorX + BANNER_OFFSET : cursorX - BANNER_OFFSET - width
      measured[c].x = Math.min(Math.max(x, 0), Math.max(plotWidth - width, 0))
    }

    return { time, cursorX, charts: measured }
  }, [camera, charts, dataKey, domainEndMs, domainStartMs, glyphWidth, timeline])
}

/**
 * Per-series dots and the readout banner, inside the canvas. The cursor line is drawn once for
 * the whole stack — see {@link ScrubCursor}.
 *
 * Nothing here touches React state. The layer answers to one shared value, so a chart scrubbed
 * by a finger and a chart following a neighbour run exactly the same code and look identical;
 * the old readout mounted and unmounted React views on every drag, which is what made it lag.
 */
export function ScrubLayer({ targets, plot, index: chart, readout, font }: ScrubLayerProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  // The row count never changes, so the banner is only ever as tall as the series it carries.
  const height = targets.length * ROW_HEIGHT + PADDING * 2
  const centeredY = Math.max((plot.height - height) / 2, 0)

  const opacity = useDerivedValue(() => (readout.value.charts.length === 0 ? 0 : 1), [])
  // A translated group, so the banner moves as one node instead of a value per child.
  const bannerTransform = useDerivedValue(
    () => [{ translateX: readout.value.charts[chart]?.x ?? 0 }, { translateY: centeredY }],
    [centeredY, chart],
  )
  const bannerWidth = useDerivedValue(() => readout.value.charts[chart]?.width ?? 0, [chart])
  if (targets.length === 0) return null

  return (
    <Group
      opacity={opacity}
      transform={[{ translateX: plot.x }, { translateY: plot.y }]}
      clip={{ x: 0, y: 0, width: plot.width, height: plot.height }}
    >
      {targets.map((target, index) => (
        <ScrubDot key={index} chart={chart} index={index} color={target.color} readout={readout} />
      ))}

      <Group transform={bannerTransform}>
        <RoundedRect x={0} y={0} width={bannerWidth} height={height} r={RADIUS} color={BANNER_BG} />
        <RoundedRect
          x={0}
          y={0}
          width={bannerWidth}
          height={height}
          r={RADIUS}
          color={BANNER_BORDER}
          style="stroke"
          strokeWidth={0.5}
        />
        {targets.map((target, index) => (
          <ScrubRow
            key={index}
            chart={chart}
            index={index}
            color={target.color}
            readout={readout}
            font={font}
          />
        ))}
      </Group>
    </Group>
  )
}

interface ScrubRowProps {
  chart: number
  index: number
  color: string
  readout: SharedValue<StackReadout>
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
}

function ScrubRow({ chart, index, color, readout, font }: ScrubRowProps) {
  'use no memo'
  const text = useDerivedValue(() => readout.value.charts[chart]?.rows[index] ?? '', [chart, index])

  return (
    <Text
      font={font}
      x={PADDING}
      y={PADDING + FONT_SIZE + ROW_HEIGHT * index}
      text={text}
      color={color}
    />
  )
}

interface ScrubDotProps {
  chart: number
  index: number
  color: string
  readout: SharedValue<StackReadout>
}

/** The sample the readout is quoting, marked on the line — same worklet, same frame. */
function ScrubDot({ chart, index, color, readout }: ScrubDotProps) {
  'use no memo'
  const transform = useDerivedValue(() => {
    const dots = (readout.value.charts[chart] ?? EMPTY_CHART_READOUT).dots
    return [
      { translateX: dots[index * 2] ?? OFFSCREEN },
      { translateY: dots[index * 2 + 1] ?? OFFSCREEN },
    ]
  }, [chart, index])

  return (
    <Group transform={transform}>
      <Circle cx={0} cy={0} r={DOT_RADIUS} color={color} />
    </Group>
  )
}

export interface ScrubCursorProps {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotX: number
  plotWidth: number
  /** Canvas y bounds the cursor spans — the first plot's top to the last plot's bottom. */
  top: number
  bottom: number
  scrubTimeMs: SharedValue<number | null>
  /** The cursor marks a real moment on a plot drawn in compacted time. */
  timeline: ChartTimeline | null
}

/**
 * The scrub cursor, drawn once across the whole stack.
 *
 * The charts of a stack share one x scale, so the cursor is one line rather than one per plot:
 * a single node, and it reads as one moment cutting through every metric instead of a row of
 * marks that merely happen to line up.
 */
export function ScrubCursor({
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotX,
  plotWidth,
  top,
  bottom,
  scrubTimeMs,
  timeline,
}: ScrubCursorProps) {
  'use no memo'
  const transform = useDerivedValue(() => {
    const timeMs = scrubTimeMs.value
    if (timeMs == null) return [{ translateX: OFFSCREEN }]
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    return [{ translateX: plotX + projectX(toChartMs(timeMs, timeline), viewport, plotWidth) }]
  }, [camera, dataKey, domainEndMs, domainStartMs, plotWidth, plotX, timeline])

  return (
    <Group clip={{ x: plotX, y: top, width: plotWidth, height: bottom - top }}>
      <Group transform={transform}>
        <Rect x={0} y={top} width={1} height={bottom - top} color={CURSOR_COLOR} />
      </Group>
    </Group>
  )
}
