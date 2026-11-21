import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { viewportFor } from '@/components/charts/line/projection'
import type { ChartCamera, ChartViewport } from '@/components/charts/line/types'

export interface ChartCameraState {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  viewport: Readonly<SharedValue<ChartViewport>>
}

export interface ChartDomain {
  startMs: number
  endMs: number
  dataKey?: string
}

const FULL_VIEW: ChartCamera = { spanMs: 0, endMs: null, key: null }

export function useChartCamera({ startMs, endMs, dataKey = '' }: ChartDomain): ChartCameraState {
  'use no memo'
  const camera = useSharedValue<ChartCamera>(FULL_VIEW)

  const viewport = useDerivedValue(
    () => viewportFor(camera.value, dataKey, startMs, endMs),
    [dataKey, endMs, startMs],
  )

  return { camera, dataKey, domainStartMs: startMs, domainEndMs: endMs, viewport }
}
