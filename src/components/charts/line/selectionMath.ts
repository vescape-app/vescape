import type { ChartTimeRange } from '@/components/charts/line/types'

export type SelectionEdge = 'start' | 'end'

export function pickSelectionEdge(touchX: number, startX: number, endX: number): SelectionEdge {
  'worklet'
  return touchX <= startX + (endX - startX) / 2 ? 'start' : 'end'
}

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
