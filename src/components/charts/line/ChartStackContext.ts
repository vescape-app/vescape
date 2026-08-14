import { createContext, useContext } from 'react'
import type { SharedValue } from 'react-native-reanimated'

import type { StackReadout } from '@/components/charts/line/ScrubLayer'
import type { ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartCamera, ChartTimeRange } from '@/components/charts/line/types'
import type { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'

/**
 * Everything the charts of a stack must agree on, held as shared values.
 *
 * Each chart draws into its own canvas, so nothing about the stack survives as shared geometry —
 * what makes them one group is that they read the same camera, the same scrub head and the same
 * readout, all on the UI thread. Two charts cannot disagree about where a moment sits, and
 * opening a third costs the others nothing: no picture of theirs is re-recorded.
 *
 * Only shared values and plain scalars belong here. A worklet freezes every object it captures,
 * so consumers must destructure what they need and never read `context.camera.value` inside one.
 */
export interface ChartStackContextValue {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  scrubTimeMs: SharedValue<number | null>
  selection?: SharedValue<ChartTimeRange | null>
  readout: SharedValue<StackReadout>
  /** Cuts the plots draw through; every chart of a stack draws the same compacted time. */
  timeline: ChartTimeline | null
  /** Ranges belonging to the ride rather than to a metric, already in chart time. */
  stackBands?: ChartBand[]
  /** No series has data yet: the frames are drawn, the times under them would be meaningless. */
  isEmpty: boolean
  /** Width of one plot, gutters already taken off. Identical for every chart in the stack. */
  plotWidth: number
  labelFont: ReturnType<typeof useSkiaFont>
  axisFont: ReturnType<typeof useSkiaMonoFont>
  scrubFont: ReturnType<typeof useSkiaMonoFont>
  showHead: boolean
}

const ChartStackContext = createContext<ChartStackContextValue | null>(null)

export const ChartStackProvider = ChartStackContext.Provider

export function useChartStack(): ChartStackContextValue {
  const value = useContext(ChartStackContext)
  if (value == null) throw new Error('useChartStack must be used inside a ChartStack')
  return value
}
