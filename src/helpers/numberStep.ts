/** Delta to the next clean step in the requested direction, including converted boundaries. */
export function stepDelta(value: number, direction: 1 | -1, step = 1): number {
  const position = value / step
  const nearest = Math.round(position)
  const onBoundary = Math.abs(position - nearest) < 1e-9
  const next = onBoundary
    ? nearest + direction
    : direction === 1
      ? Math.ceil(position)
      : Math.floor(position)
  return Math.abs(next * step - value)
}
