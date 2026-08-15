/**
 * Critically damped spring math for camera axes.
 *
 * Closed-form integration (stable for any dt):
 *   x(t) = target + (A + B·t)·e^(−ω·t)   A = x0 − target, B = v0 + ω·A
 *   v(t) = (B − ω·(A + B·t))·e^(−ω·t)
 *
 * Retargeting mid-flight keeps position and velocity continuous — no
 * stop-and-restart, motion stays C1 no matter how often targets change.
 */

export interface SpringState {
  /** Current position. */
  x: number
  /** Current velocity (units per second). */
  v: number
  /** Where the spring is heading. */
  target: number
}

/** Angular frequency ω (rad/s). Higher = stiffer. ~2π/ω ≈ visual settle time. */
export type SpringOmega = number

export function createSpring(x: number): SpringState {
  return { x, v: 0, target: x }
}

export function stepSpring(
  spring: SpringState,
  omega: SpringOmega,
  dtSeconds: number,
): SpringState {
  const a = spring.x - spring.target
  const b = spring.v + omega * a
  const decay = Math.exp(-omega * dtSeconds)
  return {
    x: spring.target + (a + b * dtSeconds) * decay,
    v: (b - omega * (a + b * dtSeconds)) * decay,
    target: spring.target,
  }
}

export function retargetSpring(spring: SpringState, target: number): SpringState {
  return { x: spring.x, v: spring.v, target }
}

/** Jump position to target instantly, killing velocity. */
export function snapSpring(spring: SpringState, target: number): SpringState {
  return { x: target, v: 0, target }
}

/**
 * Overwrite position from an external driver (gesture pass-through), deriving
 * velocity from the sample so a later retarget continues the motion smoothly.
 */
export function driveSpring(spring: SpringState, x: number, dtSeconds: number): SpringState {
  const v = dtSeconds > 0 ? (x - spring.x) / dtSeconds : spring.v
  return { x, v, target: x }
}

export function springSettled(
  spring: SpringState,
  positionEpsilon: number,
  velocityEpsilon: number,
): boolean {
  return (
    Math.abs(spring.x - spring.target) < positionEpsilon && Math.abs(spring.v) < velocityEpsilon
  )
}

/** Normalize an angle delta to (−180, 180]. */
export function shortestArcDelta(deltaDeg: number): number {
  const wrapped = ((deltaDeg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/**
 * Represent a bearing target as the closest unwrapped angle to the spring's
 * current position, so 359° → 1° travels +2° instead of −358°. The spring's x
 * is unbounded; normalize with `normalizeBearing` only when emitting.
 */
export function nearestBearingTarget(currentX: number, targetBearingDeg: number): number {
  return currentX + shortestArcDelta(targetBearingDeg - currentX)
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}
