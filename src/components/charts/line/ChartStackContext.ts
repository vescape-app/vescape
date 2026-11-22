import { createContext, useContext } from 'react'
import type { SharedValue } from 'react-native-reanimated'

import type { StackReadout } from '@/components/charts/line/ScrubLayer'
import type { ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartCamera, ChartTimeRange } from '@/components/charts/line/types'
import type { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'

export interface ChartStackContextValue {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  scrubTimeMs: SharedValue<number | null>
  selection?: SharedValue<ChartTimeRange | null>
  readout: SharedValue<StackReadout>
  timeline: ChartTimeline | null
  stackBands?: ChartBand[]
  isEmpty: boolean
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
