import { DashPathEffect, Group, Line, Text, vec } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { formatClock } from '@/helpers/time'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { projectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera } from '@/components/charts/line/types'
import type { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { textAdvanceWidth } from '../../../helpers/skiaText'

const DASH = [3, 3]
const LABEL_GAP = 4
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
      variant: 'seam'
      top: number
      bottom: number
    }
  | {
      variant: 'labels'
      labelBaseline: number
    }

export type GapMarkersLayerProps = GapMarkersCommonProps & GapMarkersVariant

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
    chartMs: number
    startMs: number
    endMs: number
  }

function GapMarker(props: GapMarkerProps) {
  'use no memo'
  const { timeFormat } = useUserPreferences()
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
  const startLabel = formatClock(startMs, false, timeFormat)
  const endLabel = formatClock(endMs, false, timeFormat)
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
