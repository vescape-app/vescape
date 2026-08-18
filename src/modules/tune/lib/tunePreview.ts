'worklet'
import {
  MAX_ANGLE_DEGREES,
  type TunePreviewInput,
  type TunePreviewParameters,
  type TunePreviewState,
  type TunePreviewTarget,
} from '@/modules/tune/lib/tunePreviewContract'
import {
  aggregateTorqueAndAdaptiveTilt,
  calculateAtrExpectedAcceleration,
  calculateControllerCurrentAmps,
  calculateLongitudinalTarget,
  BALANCE_PITCH_AUTHORITY,
  calculatePreviewAcceleration,
  calculateTerrainLoadCurrentAmps,
  calculateTerrainSlope,
} from '@/modules/tune/lib/tunePreviewDynamics'
import { clamp, finiteOrZero, moveTowards } from '@/modules/tune/lib/tunePreviewMath'
import { calculatePitchAcceleration } from '@/modules/tune/lib/tunePreviewResponse'
import {
  boundedSpeed,
  pitchInputControlToRate,
  resolveTunePreviewPhysics,
  speedKmhToErpm,
} from '@/modules/tune/lib/tunePreviewModel'

export * from '@/modules/tune/lib/tunePreviewContract'
export * from '@/modules/tune/lib/tunePreviewDynamics'
export * from '@/modules/tune/lib/tunePreviewModel'

const MAX_ELAPSED_SECONDS = 0.25
const REFLOAT_LOOP_HZ = 832
const STEP_SECONDS = 1 / REFLOAT_LOOP_HZ
const MAX_RATE_DEGREES_PER_SECOND = 120
const PITCH_INPUT_RESPONSE_PER_SECOND = 12

/** Pitch Input eases towards its requested rate instead of snapping, so the tune sees a ramp. */
function stepPitchInputRate(state: TunePreviewState, input: TunePreviewInput, dt: number): number {
  if (input.pitchInputActive !== true) return 0
  const requested = pitchInputControlToRate(input.pitchInputDegrees)
  const previous = finiteOrZero(state.pitchInputRateDegreesPerSecond)
  return previous + (requested - previous) * (1 - Math.exp(-PITCH_INPUT_RESPONSE_PER_SECOND * dt))
}

function atrAccelDiffAlpha(erpmMagnitude: number): number {
  if (erpmMagnitude > 2000) return 0.1
  if (erpmMagnitude > 1000) return 0.05
  return 0.02
}

function atrStrength(
  parameters: TunePreviewParameters,
  accelDiff: number,
  erpmMagnitude: number,
  braking: boolean,
): number {
  const base = accelDiff >= 0 ? parameters.atrStrengthUp : parameters.atrStrengthDown
  if (erpmMagnitude <= 3000 || braking) return base
  const boost = Math.abs(parameters.atrSpeedBoost)
  const span = boost > 0.4 ? (boost - 0.4) * 5000 + 3000 : 3000
  return base * (1 + Math.min(1, (erpmMagnitude - 3000) / span) * parameters.atrSpeedBoost)
}

function atrRate(
  parameters: TunePreviewParameters,
  currentDegrees: number,
  targetDegrees: number,
  erpmMagnitude: number,
): number {
  let rate =
    Math.abs(targetDegrees) > Math.abs(currentDegrees)
      ? parameters.atrOnSpeed
      : parameters.atrOffSpeed
  if (currentDegrees * targetDegrees < 0 && Math.abs(targetDegrees - currentDegrees) > 2) {
    rate *= parameters.atrTransitionBoost
  }
  if (erpmMagnitude > 2500) rate *= parameters.atrResponseBoost
  if (erpmMagnitude > 6000) rate *= parameters.atrResponseBoost
  return rate
}

interface AtrStep {
  atrAccelDiff: number
  atrTargetDegrees: number
  atrDegrees: number
}

/** Refloat ATR: filtered acceleration error becomes a rate-limited tilt target. */
function stepAtr(
  state: TunePreviewState,
  parameters: TunePreviewParameters,
  filteredCurrentAmps: number,
  syntheticSpeedKmh: number,
  erpm: number,
  braking: boolean,
  dt: number,
): AtrStep {
  const ratio = Math.max(braking ? parameters.atrAmpsDecelRatio : parameters.atrAmpsAccelRatio, 0.1)
  const erpmSign = erpm === 0 ? 0 : Math.sign(syntheticSpeedKmh || 1)
  const rawAccelDiff =
    calculateAtrExpectedAcceleration(filteredCurrentAmps, erpmSign, ratio) -
    state.measuredAccelerationErpmPerTick
  const erpmMagnitude = Math.abs(erpm)
  const atrAccelDiff =
    erpmMagnitude > 250
      ? state.atrAccelDiff + (rawAccelDiff - state.atrAccelDiff) * atrAccelDiffAlpha(erpmMagnitude)
      : 0

  const threshold = braking ? parameters.atrThresholdDown : parameters.atrThresholdUp
  const rawAtr = atrStrength(parameters, atrAccelDiff, erpmMagnitude, braking) * atrAccelDiff
  const thresholded = Math.abs(rawAtr) < threshold ? 0 : rawAtr - Math.sign(rawAtr) * threshold
  const atrTargetDegrees = clamp(
    state.atrTargetDegrees * 0.95 + thresholded * 0.05,
    -parameters.atrAngleLimit,
    parameters.atrAngleLimit,
  )

  return {
    atrAccelDiff,
    atrTargetDegrees,
    atrDegrees: moveTowards(
      state.atrDegrees,
      atrTargetDegrees,
      atrRate(parameters, state.atrDegrees, atrTargetDegrees, erpmMagnitude) * dt,
    ),
  }
}

/** Refloat combines Torque Tilt with ATR + Brake Tilt, then clamps the setpoint. */
function totalTargetDegrees(target: TunePreviewTarget, atrDegrees: number): number {
  const torqueAndAdaptiveDegrees = aggregateTorqueAndAdaptiveTilt(
    target.torqueTiltDegrees,
    atrDegrees + target.brakeTiltDegrees,
  )
  return clamp(
    torqueAndAdaptiveDegrees + target.constantTiltbackDegrees + target.variableTiltbackDegrees,
    -MAX_ANGLE_DEGREES,
    MAX_ANGLE_DEGREES,
  )
}

function stepFixed(
  state: TunePreviewState,
  parameters: TunePreviewParameters,
  input: TunePreviewInput,
  dt: number,
): TunePreviewState {
  const physics = resolveTunePreviewPhysics(input.advancedPhysics)
  const pitchInputRateDegreesPerSecond = stepPitchInputRate(state, input, dt)
  const controlledRateDegreesPerSecond =
    state.angularRateDegreesPerSecond + pitchInputRateDegreesPerSecond
  const currentLimit = physics.maxMotorCurrentAmps
  const balanceCurrentAmps = calculateControllerCurrentAmps(
    state.angleDegrees,
    controlledRateDegreesPerSecond,
    state.integralError,
    state.targetAngleDegrees,
    parameters,
    currentLimit,
  )

  const terrainSlope = calculateTerrainSlope(state.groundTravelMeters, input)
  const terrainLoadCurrentAmps = calculateTerrainLoadCurrentAmps(terrainSlope, physics)
  const syntheticCurrentAmps = clamp(
    balanceCurrentAmps + terrainLoadCurrentAmps + finiteOrZero(input.riderLoadCurrentAmps ?? 0),
    -currentLimit,
    currentLimit,
  )
  const currentFilterAlpha = 1 - Math.exp(-2 * Math.PI * Math.max(parameters.atrFilter, 0) * dt)
  const filteredCurrentAmps =
    state.filteredCurrentAmps +
    (syntheticCurrentAmps - state.filteredCurrentAmps) * currentFilterAlpha
  const syntheticSpeedKmh = boundedSpeed(
    state.syntheticSpeedKmh +
      calculatePreviewAcceleration(syntheticCurrentAmps, terrainSlope, physics) * dt,
  )

  const target = calculateLongitudinalTarget(
    state,
    parameters,
    { ...input, speedKmh: syntheticSpeedKmh, advancedPhysics: physics },
    dt,
    filteredCurrentAmps,
  )
  const braking =
    syntheticSpeedKmh === 0 ? filteredCurrentAmps < 0 : filteredCurrentAmps * syntheticSpeedKmh < 0
  const atr = stepAtr(
    state,
    parameters,
    filteredCurrentAmps,
    syntheticSpeedKmh,
    target.erpm,
    braking,
    dt,
  )
  const targetAngleDegrees = totalTargetDegrees(target, atr.atrDegrees)

  const integralLimit = parameters.kiLimit > 0 ? parameters.kiLimit : Number.POSITIVE_INFINITY
  const integralError = clamp(
    state.integralError + (targetAngleDegrees - state.angleDegrees) * parameters.ki,
    -integralLimit,
    integralLimit,
  )

  // Pitch Input adds a bounded pitch rate instead of imposing an angle. The tune reacts to
  // the growing error during the gesture and owns recovery after the gesture ends. Pitch response
  // uses PID balance effort; terrain-load current remains in total current and longitudinal speed.
  const balancePitchAccelerationDegrees =
    (((calculatePreviewAcceleration(balanceCurrentAmps, 0, physics) / 3.6) *
      BALANCE_PITCH_AUTHORITY) /
      physics.centerOfMassHeightMeters) *
    (180 / Math.PI)
  const angularAcceleration = calculatePitchAcceleration(
    balancePitchAccelerationDegrees,
    input.riderLeanAngleDegrees == null
      ? null
      : finiteOrZero(input.riderLeanAngleDegrees) - state.angleDegrees,
    controlledRateDegreesPerSecond,
    physics.pitchDampingPerSecond,
  )
  const angularRateDegreesPerSecond = clamp(
    state.angularRateDegreesPerSecond + angularAcceleration * dt,
    -MAX_RATE_DEGREES_PER_SECOND,
    MAX_RATE_DEGREES_PER_SECOND,
  )
  const angleDegrees = clamp(
    state.angleDegrees + (angularRateDegreesPerSecond + pitchInputRateDegreesPerSecond) * dt,
    -MAX_ANGLE_DEGREES,
    MAX_ANGLE_DEGREES,
  )

  const erpm = speedKmhToErpm(syntheticSpeedKmh, physics)
  const measuredAccelerationErpmPerTick =
    state.measuredAccelerationErpmPerTick +
    (erpm - state.erpm - state.measuredAccelerationErpmPerTick) / 40

  return {
    syntheticSpeedKmh,
    angleDegrees: finiteOrZero(angleDegrees),
    angularRateDegreesPerSecond: finiteOrZero(angularRateDegreesPerSecond),
    pitchInputRateDegreesPerSecond: finiteOrZero(pitchInputRateDegreesPerSecond),
    integralError: finiteOrZero(integralError),
    targetAngleDegrees,
    torqueTiltDegrees: target.torqueTiltDegrees,
    brakeTiltDegrees: target.brakeTiltDegrees,
    atrDegrees: atr.atrDegrees,
    constantTiltbackDegrees: target.constantTiltbackDegrees,
    variableTiltbackDegrees: target.variableTiltbackDegrees,
    syntheticCurrentAmps: finiteOrZero(syntheticCurrentAmps),
    filteredCurrentAmps: finiteOrZero(filteredCurrentAmps),
    erpm,
    groundTravelMeters: state.groundTravelMeters + (syntheticSpeedKmh / 3.6) * dt,
    terrainSlope,
    terrainLoadCurrentAmps,
    atrAccelDiff: atr.atrAccelDiff,
    atrTargetDegrees: atr.atrTargetDegrees,
    measuredAccelerationErpmPerTick: finiteOrZero(measuredAccelerationErpmPerTick),
  }
}

export function stepTunePreview(
  state: TunePreviewState,
  parameters: TunePreviewParameters,
  input: TunePreviewInput,
  elapsedSeconds: number,
): TunePreviewState {
  if (input.paused || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return state

  let next = state
  let remaining = Math.min(elapsedSeconds, MAX_ELAPSED_SECONDS)
  while (remaining > 0) {
    const dt = Math.min(STEP_SECONDS, remaining)
    next = stepFixed(next, parameters, input, dt)
    remaining -= dt
  }
  return next
}
