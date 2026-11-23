import { Circle, Group, Rect, RoundedRect, Text } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { formatClock } from '@/helpers/time'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { projectX, projectY, viewportFor } from '@/components/charts/line/projection'
import { sampleAtSec } from '@/components/charts/line/seriesPaths'
import type { ScrubTarget } from '@/components/charts/line/scrubTargets'
import { toChartMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera, ChartPlotBox } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'

const CURSOR_COLOR = theme.palette.slate.border
const BANNER_BG = theme.alpha(theme.palette.slate.surfaceDeep, 0.85)
const BANNER_BORDER = theme.palette.slate.surface
export const SCRUB_FONT_SIZE = 11
const FONT_SIZE = SCRUB_FONT_SIZE
const ROW_HEIGHT = FONT_SIZE + 4
const PADDING = 5
const RADIUS = 5
const BANNER_OFFSET = 8
const DOT_RADIUS = 3
const OFFSCREEN = -1_000

export interface ScrubLayerProps {
  targets: ScrubTarget[]
  plot: ChartPlotBox
  index: number
  readout: SharedValue<StackReadout>
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
}

interface ChartReadout {
  x: number
  width: number
  rows: string[]
  dots: number[]
}

export interface StackReadout {
  time: string
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
  timeline: ChartTimeline | null
  glyphWidth: number
}

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
  'use no memo'
  const { timeFormat } = useUserPreferences()
  return useDerivedValue<StackReadout>(() => {
    const timeMs = scrubTimeMs.value
    if (timeMs == null) return EMPTY_READOUT

    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const chartMs = toChartMs(timeMs, timeline)
    const time = formatClock(timeMs, true, timeFormat)

    const plotWidth = charts.length > 0 ? charts[0].plot.width : 0
    const cursorX = projectX(chartMs, viewport, plotWidth)

    const measured: ChartReadout[] = []
    let widest = 0

    for (const chart of charts) {
      const { targets, plot } = chart

      const rows: string[] = []
      const dots: number[] = []
      let longest = 0

      for (const target of targets) {
        const { paths } = target
        const sample = sampleAtSec(paths.raw, (chartMs - paths.domainStartMs) / 1000)
        if (!sample.found) {
          rows.push(DASH)
          longest = Math.max(longest, 1)
          dots.push(OFFSCREEN, OFFSCREEN)
          continue
        }

        const decimals = target.decimals ?? 1
        const displayValue = sample.value * (target.displayScale ?? 1) + (target.displayOffset ?? 0)
        const formatted =
          decimals === 0 ? Math.round(displayValue).toString() : displayValue.toFixed(decimals)
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

    const onRight = cursorX + BANNER_OFFSET + widest <= plotWidth
    for (const banner of measured) {
      const { width } = banner
      const x = onRight ? cursorX + BANNER_OFFSET : cursorX - BANNER_OFFSET - width
      banner.x = Math.min(Math.max(x, 0), Math.max(plotWidth - width, 0))
    }

    return { time, cursorX, charts: measured }
  }, [camera, charts, dataKey, domainEndMs, domainStartMs, glyphWidth, timeFormat, timeline])
}

export function ScrubLayer({ targets, plot, index: chart, readout, font }: ScrubLayerProps) {
  'use no memo'
  const height = targets.length * ROW_HEIGHT + PADDING * 2
  const centeredY = Math.max((plot.height - height) / 2, 0)

  const opacity = useDerivedValue(() => (readout.value.charts.length === 0 ? 0 : 1), [])
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
  top: number
  bottom: number
  scrubTimeMs: SharedValue<number | null>
  timeline: ChartTimeline | null
}

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
