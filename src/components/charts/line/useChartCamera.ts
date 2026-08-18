import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { viewportFor } from '@/components/charts/line/projection'
import type { ChartCamera, ChartViewport } from '@/components/charts/line/types'

export interface ChartCameraState {
  camera: SharedValue<ChartCamera>
  /** Identity of the data on screen; gestures stamp it onto the camera as they write it. */
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  viewport: Readonly<SharedValue<ChartViewport>>
}

export interface ChartDomain {
  startMs: number
  endMs: number
  /**
   * Identity of the data being shown — a ride id, a focused metric. Zoom is deliberately kept
   * across data updates (a live stack slides its domain every second) and reset only when the
   * rider is looking at something else entirely.
   */
  dataKey?: string
}

/** An untouched camera belongs to no dataset, so it always resolves to the full domain. */
const FULL_VIEW: ChartCamera = { spanMs: 0, endMs: null, key: null }

/**
 * Camera shared by every chart of a stack.
 *
 * The viewport is derived, never stored: the domain enters the worklet as a plain prop with an
 * explicit dependency, so it is correct in the same commit that delivered the new data — no
 * effect runs in between, and a new dataset can never be drawn through the old viewport. Only
 * the rider's own zoom lives in a shared value, which is what keeps pinching off the JS thread.
 */
export function useChartCamera({ startMs, endMs, dataKey = '' }: ChartDomain): ChartCameraState {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const camera = useSharedValue<ChartCamera>(FULL_VIEW)

  // Used for the shared furniture — axis labels and, later, gestures. Anything that projects
  // data resolves its own viewport instead; see `viewportFor`.
  const viewport = useDerivedValue(
    () => viewportFor(camera.value, dataKey, startMs, endMs),
    [dataKey, endMs, startMs],
  )

  return { camera, dataKey, domainStartMs: startMs, domainEndMs: endMs, viewport }
}
