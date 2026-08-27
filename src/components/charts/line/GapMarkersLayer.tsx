import { DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { formatClock } from '@/components/charts/line/chartFormat'
import { projectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { textAdvanceWidth } from '../../../helpers/skiaText'

const DASH = [3, 3]
/** Clearance between the seam and the times either side of it. */
const LABEL_GAP = 4
/** Parked off-canvas rather than unmounted, so panning never touches the tree. */
const OFFSCREEN = -1_000

interface GapMarkersCommonProps {
  timeline: ChartTimeline | null
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotX: number
  plotWidth: number
  font: NonNullable<ReturnType<typeof useSkiaMonoFont>>
}

type GapMarkersVariant =
  | {
      /** The dotted line through a plot. Drawn once per chart, in that chart's canvas. */
      variant: 'seam'
      /** Canvas y bounds the seam spans. */
      top: number
      bottom: number
    }
  | {
      /** The times either side of the cut. Drawn once, on the row that already reads as time. */
      variant: 'labels'
      labelBaseline: number
    }

export type GapMarkersLayerProps = GapMarkersCommonProps & GapMarkersVariant

/**
 * The seam left where a long pause was cut out: a dotted line, with the time the rider stopped on
 * one side of it and the time they set off again on the other.
 *
 * Without the mark the chart would quietly lie — two stretches of riding half an hour apart drawn
 * as if they were continuous. The times are what turn the seam into an explanation.
 *
 * Split across two canvases because the stack is: the seam belongs to a plot and is drawn in every
 * chart, the times belong to the time axis and are drawn once under all of them. Both read the
 * same camera, so they stay on the same x with no coordination.
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

type GapMarkerProps = Omit<GapMarkersCommonProps, 'timeline'> &
  GapMarkersVariant & {
    /** Middle of the seam in chart time. */
    chartMs: number
    /** Real bounds of the cut, for the labels. */
    startMs: number
    endMs: number
  }

function GapMarker(props: GapMarkerProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const neutral = useResolvedNeutralColors()
  const {
    chartMs,
    startMs,
    endMs,
    camera,
    dataKey,
    domainStartMs,
    domainEndMs,
    plotX,
    plotWidth,
    font,
  } = props
  const startLabel = formatClock(startMs, false)
  const endLabel = formatClock(endMs, false)
  const startWidth = textAdvanceWidth(font, startLabel)

  const transform = useDerivedValue(() => {
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const x = projectX(chartMs, viewport, plotWidth)
    if (x < 0 || x > plotWidth) return [{ translateX: OFFSCREEN }]
    return [{ translateX: plotX + x }]
  }, [camera, chartMs, dataKey, domainEndMs, domainStartMs, plotWidth, plotX])

  if (props.variant === 'seam') {
    return (
      <Group transform={transform}>
        <Line
          p1={vec(0, props.top)}
          p2={vec(0, props.bottom)}
          color={neutral.textMuted}
          strokeWidth={1}
        >
          <DashPathEffect intervals={DASH} />
        </Line>
      </Group>
    )
  }

  return (
    <Group transform={transform}>
      <Text
        font={font}
        x={-LABEL_GAP - startWidth}
        y={props.labelBaseline}
        text={startLabel}
        color={neutral.textDim}
      />
      <Text
        font={font}
        x={LABEL_GAP}
        y={props.labelBaseline}
        text={endLabel}
        color={neutral.textDim}
      />
    </Group>
  )
}
