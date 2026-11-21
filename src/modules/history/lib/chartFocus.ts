import { makeMutable } from 'react-native-reanimated'

import type { ChartTimeRange } from '@/components/charts/line/types'
import type { TelemetrySample } from 'vescape-core'

export const scrubHeadMs = makeMutable<number | null>(null)

export const zoomWindowMs = makeMutable<ChartTimeRange | null>(null)

export type RideFocus = 'topSpeed'

export const RIDE_FOCUSES: readonly RideFocus[] = ['topSpeed']

export function peakSpeedAtMs(samples: readonly TelemetrySample[]): number | null {
  let peak: TelemetrySample | null = null
  for (const sample of samples) {
    if (peak == null || Math.abs(sample.speedKmh) > Math.abs(peak.speedKmh)) peak = sample
  }
  return peak?.capturedAtMs ?? null
}
