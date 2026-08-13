import { DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { formatClock } from '@/components/charts/line/chartFormat'
import { projectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'

const LINE_COLOR = theme.palette.slate.textMuted
/** The same dim as the ride's own start and end labels — the seam times belong to that row. */
const LABEL_COLOR = theme.palette.slate.textDim
const DASH = [3, 3]
/** Clearance between the seam and the times either side of it. */
const LABEL_GAP = 4
/** Parked off-canvas rather than unmounted, so panning never touches the tree. */
const OFFSCREEN = -1_000

export interface GapMarkersLayerProps {
  timeline: ChartTimeline | null
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotX: number
  plotWidth: number
  /** Canvas y bounds the seam spans — the first plot's top to the last plot's bottom. */
  top: number
  bottom: number
  /** Baseline of the shared time axis: the times sit on the row that already reads as time. */
  labelBaseline: number
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
}

/**
 * The seam left where a long pause was cut out: a dotted line, with the time the rider stopped on
 * one side of it and the time they set off again on the other.
 *
 * Without the mark the chart would quietly lie — two stretches of riding half an hour apart drawn
 * as if they were continuous. The times are what turn the seam into an explanation.
 */
export function GapMarkersLayer({ timeline, ...rest }: GapMarkersLayerProps) {
  if (timeline == null) return null
  return (
    <>
      {timeline.gapChartMs.map((chartMs, index) => (
        <GapMarker
          key={chartMs}
          chartMs={chartMs + timeline.gapWidthMs / 2}
          startMs={timeline.gapStartMs[index]}
          endMs={timeline.gapEndMs[index]}
          {...rest}
        />
      ))}
    </>
  )
}

interface GapMarkerProps extends Omit<GapMarkersLayerProps, 'timeline'> {
  /** Middle of the seam in chart time. */
  chartMs: number
  /** Real bounds of the cut, for the labels. */
  startMs: number
  endMs: number
}

function GapMarker({
  chartMs,
  startMs,
  endMs,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotX,
  plotWidth,
  top,
  bottom,
  labelBaseline,
  font,
}: GapMarkerProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const startLabel = formatClock(startMs, false)
  const endLabel = formatClock(endMs, false)
  const startWidth = font.getTextWidth(startLabel)

  const transform = useDerivedValue(() => {
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const x = projectX(chartMs, viewport, plotWidth)
    if (x < 0 || x > plotWidth) return [{ translateX: OFFSCREEN }]
    return [{ translateX: plotX + x }]
  }, [camera, chartMs, dataKey, domainEndMs, domainStartMs, plotWidth, plotX])

  return (
    <Group transform={transform}>
      <Line p1={vec(0, top)} p2={vec(0, bottom)} color={LINE_COLOR} strokeWidth={1}>
        <DashPathEffect intervals={DASH} />
      </Line>
      <Text
        font={font}
        x={-LABEL_GAP - startWidth}
        y={labelBaseline}
        text={startLabel}
        color={LABEL_COLOR}
      />
      <Text font={font} x={LABEL_GAP} y={labelBaseline} text={endLabel} color={LABEL_COLOR} />
    </Group>
  )
}
