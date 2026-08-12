'worklet'

const RIDER_LEAN_RESPONSE_PER_SECOND = 5

/**
 * Critically damped angular response for the controlled Response comparison. The implied rider
 * moment cancels the free-model Balance acceleration, then holds a safe requested posture.
 */
export function calculatePitchAcceleration(
  balanceAccelerationDegrees: number,
  riderLeanAngleErrorDegrees: number | null,
  angularRateDegreesPerSecond: number,
  dampingPerSecond: number,
): number {
  const controlledAcceleration =
    riderLeanAngleErrorDegrees == null
      ? balanceAccelerationDegrees
      : riderLeanAngleErrorDegrees * RIDER_LEAN_RESPONSE_PER_SECOND ** 2 -
        angularRateDegreesPerSecond * 2 * RIDER_LEAN_RESPONSE_PER_SECOND
  return controlledAcceleration - dampingPerSecond * angularRateDegreesPerSecond
}
