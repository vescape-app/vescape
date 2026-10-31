/** Session-only test controls. Seconds/rad/s are explicit; GPS cadence is never configurable.
 * @parity /watch/wearos/src/main/java/app/vescape/wear/LiveGpsMotion.kt `MotionConfig`
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift `MotionConfig`
 */
export const motionControls = {
  predictionStrength: { value: 0.5, min: 0, max: 1, step: 0.05, unit: 'fraction' },
  pointWindow: { value: 2, min: 2, max: 6, step: 1, unit: 'points' },
  cameraWindow: { value: 3, min: 2, max: 6, step: 1, unit: 'points' },
  movementM: { value: 2, min: 0.5, max: 10, step: 0.5, unit: 'm' },
  accuracyMovementRatio: { value: 0.3, min: 0.1, max: 1, step: 0.1, unit: 'fraction' },
  fullConfidenceM: { value: 6, min: 2, max: 20, step: 1, unit: 'm' },
  goodAccuracyM: { value: 5, min: 1, max: 10, step: 1, unit: 'm' },
  maxAccuracyM: { value: 25, min: 11, max: 50, step: 1, unit: 'm' },
  gpsFreshnessS: { value: 3, min: 0.5, max: 10, step: 0.5, unit: 's' },
  telemetryFreshnessS: { value: 1, min: 0.25, max: 3, step: 0.25, unit: 's' },
  directionWindowS: { value: 8, min: 3, max: 20, step: 1, unit: 's' },
  directionRetentionS: { value: 2, min: 0.5, max: 5, step: 0.5, unit: 's' },
  cameraConfirmM: { value: 3, min: 1, max: 10, step: 0.5, unit: 'm' },
  cameraReverseConfirmM: { value: 8, min: 3, max: 20, step: 1, unit: 'm' },
  cameraConfirmFixes: { value: 2, min: 2, max: 6, step: 1, unit: 'fixes' },
  cameraReverseConfirmFixes: { value: 4, min: 3, max: 8, step: 1, unit: 'fixes' },
  predictionHorizonS: { value: 1.5, min: 0.25, max: 3, step: 0.25, unit: 's' },
  maxPredictionM: { value: 8, min: 1, max: 15, step: 1, unit: 'm' },
  recoveryAfterS: { value: 3, min: 1, max: 6, step: 0.5, unit: 's' },
  recoverySpeedMps: { value: 2, min: 0.5, max: 5, step: 0.5, unit: 'm/s' },
  cameraPositionOmega: { value: 3, min: 1, max: 10, step: 0.5, unit: 'rad/s' },
  cameraHeadingOmega: { value: 1, min: 1, max: 10, step: 0.5, unit: 'rad/s' },
  arrowHeadingOmega: { value: 10, min: 2, max: 20, step: 1, unit: 'rad/s' },
} as const

export type MotionConfig = { [K in keyof typeof motionControls]: number }
export const defaultMotionConfig = Object.fromEntries(
  Object.entries(motionControls).map(([key, control]) => [key, control.value]),
) as MotionConfig

export function validMotionConfig(config: MotionConfig): MotionConfig {
  return Object.fromEntries(
    Object.entries(motionControls).map(([key, range]) => {
      const value = config[key as keyof MotionConfig]
      const bounded = Number.isFinite(value)
        ? Math.max(range.min, Math.min(range.max, value))
        : range.value
      return [key, key.endsWith('Window') ? Math.round(bounded) : bounded]
    }),
  ) as MotionConfig
}
