export type RailPoint = readonly [x: number, y: number]

/** Builds a rail path with optional quadratic rounding at each point. */
export function buildRailPath(points: readonly RailPoint[], smoothing: readonly number[]): string {
  const first = points[0]
  if (!first) return ''
  let path = `M${first[0]} ${first[1]}`

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    const amount = Math.max(0, Math.min(100, smoothing[index] ?? 0)) / 100
    const inset = amount * 0.42
    if (inset === 0) {
      path += ` L${current[0]} ${current[1]}`
      continue
    }
    const entryX = current[0] + (previous[0] - current[0]) * inset
    const entryY = current[1] + (previous[1] - current[1]) * inset
    const exitX = current[0] + (next[0] - current[0]) * inset
    const exitY = current[1] + (next[1] - current[1]) * inset
    path += ` L${entryX.toFixed(1)} ${entryY.toFixed(1)} Q${current[0]} ${current[1]} ${exitX.toFixed(1)} ${exitY.toFixed(1)}`
  }

  const last = points[points.length - 1]!
  return `${path} L${last[0]} ${last[1]}`
}

/** Polyline approximation of the same quadratic corners used by the editable SVG path. */
export function sampleRailProfile(
  points: readonly RailPoint[],
  smoothing: readonly number[],
): RailPoint[] {
  const first = points[0]
  if (!first) return []
  const result: RailPoint[] = [first]
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    const inset = (Math.max(0, Math.min(100, smoothing[index] ?? 0)) / 100) * 0.42
    if (!inset) {
      result.push(current)
      continue
    }
    const entry: RailPoint = [
      current[0] + (previous[0] - current[0]) * inset,
      current[1] + (previous[1] - current[1]) * inset,
    ]
    const exit: RailPoint = [
      current[0] + (next[0] - current[0]) * inset,
      current[1] + (next[1] - current[1]) * inset,
    ]
    result.push(entry)
    for (let step = 1; step <= 5; step++) {
      const t = step / 5
      const inverse = 1 - t
      result.push([
        inverse * inverse * entry[0] + 2 * inverse * t * current[0] + t * t * exit[0],
        inverse * inverse * entry[1] + 2 * inverse * t * current[1] + t * t * exit[1],
      ])
    }
  }
  result.push(points[points.length - 1]!)
  return result
}

/** Interpolates per-point values onto the sampled rail used by the 3D preview. */
export function sampleRailValues(
  points: readonly RailPoint[],
  values: readonly number[],
  sampledPoints: readonly RailPoint[],
): number[] {
  return sampledPoints.map(([x]) => {
    for (let index = 1; index < points.length; index++) {
      const x0 = points[index - 1]![0]
      const x1 = points[index]![0]
      if (x <= x1) {
        const value0 = values[index - 1]!
        const value1 = values[index]!
        return value0 + ((value1 - value0) * (x - x0)) / (x1 - x0)
      }
    }
    return values[values.length - 1]!
  })
}
