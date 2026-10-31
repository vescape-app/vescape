export const PUBLIC_RIDE_ARC = {
  width: 320,
  height: 188,
  cx: 160,
  cy: 146,
  outerRadius: 138,
  innerRadius: 48,
  knobRadius: 36,
  gap: 3,
} as const

/** Parallel, offset sides keep the gap the same width at both ends of each seam. */
export function publicRideSector(index: number) {
  const { cx, cy, outerRadius, innerRadius, gap } = PUBLIC_RIDE_ARC
  const start = Math.PI + (index * Math.PI) / 4
  const end = start + Math.PI / 4
  const outerInset = Math.asin(gap / 2 / outerRadius)
  const innerInset = Math.asin(gap / 2 / innerRadius)
  const point = (radius: number, angle: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  })
  const outerStart = point(outerRadius, start + outerInset)
  const outerEnd = point(outerRadius, end - outerInset)
  const innerEnd = point(innerRadius, end - innerInset)
  const innerStart = point(innerRadius, start + innerInset)
  return {
    outerStart,
    outerEnd,
    innerEnd,
    innerStart,
    path: `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y} Z`,
    label: point(96, (start + end) / 2),
  }
}

/** Only changes at a detent; callers can keep touch-frequency work on the UI thread. */
export function publicRideIndexAt(x: number, y: number) {
  'worklet'
  const dx = x - PUBLIC_RIDE_ARC.cx
  const dy = y - PUBLIC_RIDE_ARC.cy
  if (dx * dx + dy * dy < 12 * 12) return -1
  const angle = Math.atan2(Math.min(-0.0001, dy), dx)
  return Math.max(0, Math.min(3, Math.floor((angle + Math.PI) / (Math.PI / 4))))
}
