export interface SpringState {
  x: number
  v: number
  target: number
}

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

export function snapSpring(spring: SpringState, target: number): SpringState {
  return { x: target, v: 0, target }
}

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

export function shortestArcDelta(deltaDeg: number): number {
  const wrapped = ((deltaDeg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

export function nearestBearingTarget(currentX: number, targetBearingDeg: number): number {
  return currentX + shortestArcDelta(targetBearingDeg - currentX)
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}
