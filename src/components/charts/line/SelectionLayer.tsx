import { Group, LinearGradient, Rect, RoundedRect, vec } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { projectX, viewportFor } from '@/components/charts/line/projection'
import { toChartMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartCamera, ChartTimeRange } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'

const DIM_COLOR = theme.alpha(theme.palette.slate.bg, 0.6)
const EDGE_COLOR = theme.palette.amber.color
const HANDLE_WIDTH = 3
/** Amber pooling at each handle and fading towards the middle, so the edges read as grabbable. */
const GLOW_IN = theme.alpha(EDGE_COLOR, 0.3)
const GLOW_MID = theme.alpha(EDGE_COLOR, 0.12)
const GLOW_OUT = theme.alpha(EDGE_COLOR, 0)

export interface SelectionLayerProps {
  selection: SharedValue<ChartTimeRange | null>
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotX: number
  plotWidth: number
  /** Canvas y bounds the selection spans — the first plot's top to the last plot's bottom. */
  top: number
  bottom: number
  /** The range is real time; the plot it is drawn on is compacted. */
  timeline: ChartTimeline | null
}

/**
 * A draggable time range across the whole stack: everything outside it dimmed, an amber edge at
 * each end.
 *
 * Generic on purpose. Trimming a ride is one use of a selected range, not a mode of the chart —
 * the same primitive answers "zoom to here" and "export this stretch", and the chart only has to
 * know which moments are chosen. It looks and grabs exactly like the trim overlay it replaces;
 * the difference is that it spans the whole group of charts rather than one plot.
 */
export function SelectionLayer({
  selection,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotX,
  plotWidth,
  top,
  bottom,
  timeline,
}: SelectionLayerProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const height = bottom - top

  // One worklet for both edges: every rect and gradient below is the same decision, and splitting
  // them would let one edge reach the screen a frame before the other.
  const edges = useDerivedValue(() => {
    const range = selection.value
    if (range == null) return { left: 0, right: 0, active: false }
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    const clamp = (x: number) => Math.min(Math.max(x, 0), plotWidth)
    return {
      left: clamp(projectX(toChartMs(range.startMs, timeline), viewport, plotWidth)),
      right: clamp(projectX(toChartMs(range.endMs, timeline), viewport, plotWidth)),
      active: true,
    }
  }, [camera, dataKey, domainEndMs, domainStartMs, plotWidth, timeline])

  /*
   * Everything below moves by transform, and nothing resizes.
   *
   * A dragged edge writes on every touch sample, and what a frame costs is the number of mappers
   * that wake up and the work each one forces Skia to redo. Animating rect widths and gradient
   * endpoints meant rebuilding a shader twice a frame; instead the dim panels are plot-wide rects
   * slid into place from off-screen, and the glow is a one-pixel gradient stretched over the
   * selection, so its shader is built once and never again.
   */
  const opacity = useDerivedValue(() => (edges.value.active ? 1 : 0), [])
  const leftDim = useDerivedValue(() => [{ translateX: edges.value.left - plotWidth }], [plotWidth])
  const rightDim = useDerivedValue(() => [{ translateX: edges.value.right }], [])
  const glow = useDerivedValue(
    () => [
      { translateX: edges.value.left },
      // A degenerate scale collapses the matrix, so an empty selection keeps a sliver of width.
      { scaleX: Math.max(edges.value.right - edges.value.left, 0.001) },
    ],
    [],
  )
  const startHandle = useDerivedValue(
    () => [{ translateX: edges.value.left - HANDLE_WIDTH / 2 }],
    [],
  )
  const endHandle = useDerivedValue(
    () => [{ translateX: edges.value.right - HANDLE_WIDTH / 2 }],
    [],
  )

  // Clipped outside the translation rather than beside it: a group applies its own transform to
  // its clip, so the two on one node push the window off by the width of the gutter — the dim
  // panels miss the ends of the plot, and a handle dragged left vanishes under the edge.
  return (
    <Group opacity={opacity} clip={{ x: plotX, y: top, width: plotWidth, height }}>
      <Group transform={[{ translateX: plotX }]}>
        <Group transform={leftDim}>
          <Rect x={0} y={top} width={plotWidth} height={height} color={DIM_COLOR} />
        </Group>
        <Group transform={rightDim}>
          <Rect x={0} y={top} width={plotWidth} height={height} color={DIM_COLOR} />
        </Group>

        {/* One unit wide, stretched across the selection: amber at both edges, clear in the
            middle, and the same shader whatever the range. */}
        <Group transform={glow}>
          <Rect x={0} y={top} width={1} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(1, 0)}
              colors={[GLOW_IN, GLOW_MID, GLOW_OUT, GLOW_MID, GLOW_IN]}
              positions={[0, 0.15, 0.5, 0.85, 1]}
            />
          </Rect>
        </Group>

        <Group transform={startHandle}>
          <RoundedRect
            x={0}
            y={top}
            width={HANDLE_WIDTH}
            height={height}
            r={HANDLE_WIDTH / 2}
            color={EDGE_COLOR}
          />
        </Group>
        <Group transform={endHandle}>
          <RoundedRect
            x={0}
            y={top}
            width={HANDLE_WIDTH}
            height={height}
            r={HANDLE_WIDTH / 2}
            color={EDGE_COLOR}
          />
        </Group>
      </Group>
    </Group>
  )
}
