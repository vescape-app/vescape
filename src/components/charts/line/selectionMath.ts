import type { ChartTimeRange } from '@/components/charts/line/types'

/** Which end of a selection a touch belongs to. */
export type SelectionEdge = 'start' | 'end'

/** The selected range is two generous drag targets, split at its midpoint. */
export function pickSelectionEdge(touchX: number, startX: number, endX: number): SelectionEdge {
  'worklet'
  return touchX <= startX + (endX - startX) / 2 ? 'start' : 'end'
}

/**
 * Move one edge by how far the finger has travelled rather than to where it is, so grabbing
 * anywhere in that edge's half of the selection never snaps the handle under the finger.
 *
 * `originMs` is where the edge sat when the drag began; the opposite edge is the wall it cannot
 * cross.
 */
export function moveSelectionEdge({
  edge,
  range,
  originMs,
  translationX,
  plotWidth,
  viewportSpanMs,
  domainStartMs,
  domainEndMs,
}: {
  edge: SelectionEdge
  range: ChartTimeRange
  originMs: number
  translationX: number
  plotWidth: number
  /** Span the plot is showing — a zoomed-in chart moves fewer ms per pixel dragged. */
  viewportSpanMs: number
  domainStartMs: number
  domainEndMs: number
}): ChartTimeRange {
  'worklet'
  if (plotWidth <= 0) return range
  const movedMs = originMs + (translationX / plotWidth) * viewportSpanMs
  return edge === 'start'
    ? {
        startMs: Math.max(domainStartMs, Math.min(range.endMs, movedMs)),
        endMs: range.endMs,
      }
    : {
        startMs: range.startMs,
        endMs: Math.min(domainEndMs, Math.max(range.startMs, movedMs)),
      }
}
