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
