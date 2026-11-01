export const PUBLIC_RIDE_ARC = {
  width: 278,
  height: 153,
  cx: 139,
  cy: 134,
  outerRadius: 132,
  innerRadius: 68,
  gap: 4,
  startAngle: -170,
  sectorAngle: 40,
} as const

/** Parallel, offset sides keep the gap the same width at both ends of each seam. */
export function publicRideSector(index: number) {
  const { cx, cy, outerRadius, innerRadius, gap } = PUBLIC_RIDE_ARC
  const start = ((PUBLIC_RIDE_ARC.startAngle + index * PUBLIC_RIDE_ARC.sectorAngle) * Math.PI) / 180
  const end = start + (PUBLIC_RIDE_ARC.sectorAngle * Math.PI) / 180
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
    label: point(100, (start + end) / 2),
  }
}

/** Only changes at a detent; callers can keep touch-frequency work on the UI thread. */
export function publicRideIndexAt(x: number, y: number) {
  'worklet'
  const dx = x - PUBLIC_RIDE_ARC.cx
  const dy = y - PUBLIC_RIDE_ARC.cy
  if (dx * dx + dy * dy < 12 * 12) return -1
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle > 90) angle -= 360
  return Math.max(
    0,
    Math.min(3, Math.floor((angle - PUBLIC_RIDE_ARC.startAngle) / PUBLIC_RIDE_ARC.sectorAngle)),
  )
}
