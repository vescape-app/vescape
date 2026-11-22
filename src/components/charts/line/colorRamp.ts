import { projectY } from '@/components/charts/line/projection'
import type { ChartColorRamp, ChartYRange } from '@/components/charts/line/types'

export interface RampGradient {
  colors: string[]
  positions: number[]
}

export function resolveRampGradient(
  ramp: ChartColorRamp<string>,
  range: ChartYRange,
  height: number,
): RampGradient | null {
  if (ramp.stops.length === 0 || height <= 0) return null

  const sorted = [...ramp.stops].sort((a, b) => b.value - a.value)
  if (sorted.length === 1) {
    return { colors: [sorted[0].color, sorted[0].color], positions: [0, 1] }
  }

  const at = (value: number) => Math.min(Math.max(projectY(value, range, height) / height, 0), 1)

  const colors: string[] = []
  const positions: number[] = []

  colors.push(sorted[0].color)
  positions.push(0)

  if (ramp.mode === 'bands') {
    for (let i = 1; i < sorted.length; i += 1) {
      const boundary = at(sorted[i].value)
      colors.push(sorted[i - 1].color, sorted[i].color)
      positions.push(boundary, boundary)
    }
  } else {
    for (const stop of sorted) {
      colors.push(stop.color)
      positions.push(at(stop.value))
    }
  }

  colors.push(sorted[sorted.length - 1].color)
  positions.push(1)

  for (let i = 1; i < positions.length; i += 1) {
    positions[i] = Math.max(positions[i], positions[i - 1])
  }

  return { colors, positions }
}
