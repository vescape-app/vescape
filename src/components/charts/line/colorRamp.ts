import { projectY } from '@/components/charts/line/projection'
import type { ChartColorRamp, ChartYRange } from '@/components/charts/line/types'

/** A ramp resolved against a plot: what Skia's `LinearGradient` takes, top to bottom. */
export interface RampGradient {
  colors: string[]
  positions: number[]
}

/**
 * Resolve a value ramp into a vertical gradient across the plot.
 *
 * Runs on the JS thread, once per render. It depends on the y range and the plot height and on
 * nothing else — in particular not on the camera — because y does not zoom: the gradient a
 * series is painted with is the same at every scroll position, so panning and zooming never
 * touch it.
 *
 * Stops are emitted top-down, since a higher value sits at a smaller y.
 */
export function resolveRampGradient(
  ramp: ChartColorRamp,
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

  // The first and last colours run to the edges of the plot: a reading beyond the ramp keeps the
  // colour of the nearest stop rather than fading out of the scale.
  colors.push(sorted[0].color)
  positions.push(0)

  if (ramp.mode === 'bands') {
    // Each colour is held flat until the next boundary, so the bands read as steps.
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

  // Skia requires positions to ascend; clamping at the edges can leave them merely equal.
  for (let i = 1; i < positions.length; i += 1) {
    positions[i] = Math.max(positions[i], positions[i - 1])
  }

  return { colors, positions }
}
