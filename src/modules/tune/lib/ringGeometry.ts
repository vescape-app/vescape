// Circumcircle geometry shared by production Rings and the visual prototype.
export const ANGLES = [-Math.PI / 2, (Math.PI * 5) / 6, Math.PI / 6, Math.PI / 2]

// Linear scale: equal value intervals have equal radial travel.
export function valueRadius(percent: number, radius: number) {
  'worklet'
  return 28 + ((radius - 28) * percent) / 100
}
export function radiusValue(distance: number, radius: number) {
  'worklet'
  return Math.max(0, Math.min(100, ((distance - 28) / (radius - 28)) * 100))
}

// Circumcircle: all three radial handles lie on its edge, even with unequal values.
export function handleCircle(values: readonly number[], radius: number, center: number) {
  'worklet'
  const points = values.slice(0, 3).map((value, i) => {
    const r = valueRadius(value, radius)
    return [Math.cos(ANGLES[i]) * r, Math.sin(ANGLES[i]) * r]
  })
  const [[ax, ay], [bx, by], [cx, cy]] = points
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  const a = ax * ax + ay * ay
  const b = bx * bx + by * by
  const c = cx * cx + cy * cy
  const x = (a * (by - cy) + b * (cy - ay) + c * (ay - by)) / d
  const y = (a * (cx - bx) + b * (ax - cx) + c * (bx - ax)) / d
  return { cx: center + x, cy: center + y, r: Math.hypot(x - ax, y - ay) }
}

export interface RingCircle {
  cx: number
  cy: number
  r: number
}

function circleAxisValues(
  circle: RingCircle,
  radius: number,
  center: number,
  steps: readonly number[],
  fourth: number,
) {
  'worklet'
  const x = circle.cx - center
  const y = circle.cy - center
  const result: number[] = []
  for (let i = 0; i < 3; i++) {
    const projection = x * Math.cos(ANGLES[i]) + y * Math.sin(ANGLES[i])
    const discriminant = circle.r * circle.r - x * x - y * y + projection * projection
    if (discriminant < 0) return null
    const distance = projection + Math.sqrt(discriminant)
    if (distance < 28 || distance > radius) return null
    const percent = radiusValue(distance, radius)
    result.push(Math.max(0, Math.min(100, Math.round(percent / steps[i]) * steps[i])))
  }
  return [...result, fourth]
}

// Shared by center translation and edge resizing. Keep every handle on its axis,
// stopping the whole circle at the first parameter limit.
export function constrainCircleEdit(
  initial: RingCircle,
  desired: RingCircle,
  radius: number,
  center: number,
  steps: readonly number[],
  fourth: number,
) {
  'worklet'
  const exact = circleAxisValues(desired, radius, center, steps, fourth)
  if (exact) return exact
  let low = 0
  let high = 1
  let result: number[] | null = null
  for (let i = 0; i < 12; i++) {
    const fraction = (low + high) / 2
    const candidate = circleAxisValues(
      {
        cx: initial.cx + (desired.cx - initial.cx) * fraction,
        cy: initial.cy + (desired.cy - initial.cy) * fraction,
        r: initial.r + (desired.r - initial.r) * fraction,
      },
      radius,
      center,
      steps,
      fourth,
    )
    if (candidate) {
      low = fraction
      result = candidate
    } else {
      high = fraction
    }
  }
  return result
}

// Counter the page translation enough to leave `peek` pixels of each neighboring
// reference circle inside the viewport, even when the chart reaches its size cap.
export function ringPageRevealOffset(viewport: number, radius: number, peek = 36) {
  'worklet'
  return Math.max(0, viewport / 2 - radius + peek)
}
