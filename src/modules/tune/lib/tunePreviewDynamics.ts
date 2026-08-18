'worklet'
import {
  COMPARATIVE_ACCELERATION_KMH_PER_SECOND,
  MAX_ANGLE_DEGREES,
  MAX_SYNTHETIC_CURRENT_AMPS,
  type TunePreviewAdvancedPhysics,
  type TunePreviewInput,
  type TunePreviewParameters,
  type TunePreviewState,
  type TunePreviewTarget,
} from '@/modules/tune/lib/tunePreviewContract'
import { clamp, finiteOrZero, moveTowards } from '@/modules/tune/lib/tunePreviewMath'
import { resolveTunePreviewPhysics, speedKmhToErpm } from '@/modules/tune/lib/tunePreviewModel'

const STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665
export const BALANCE_PITCH_AUTHORITY = 9

export function calculateSyntheticAcceleration(syntheticCurrentAmps: number): number {
  return (
    (clamp(syntheticCurrentAmps, -MAX_SYNTHETIC_CURRENT_AMPS, MAX_SYNTHETIC_CURRENT_AMPS) /
      MAX_SYNTHETIC_CURRENT_AMPS) *
    COMPARATIVE_ACCELERATION_KMH_PER_SECOND
  )
}

export function terrainSlopeToSyntheticAcceleration(slope: number): number {
  const finiteSlope = finiteOrZero(slope)
  return (
    (STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED * finiteSlope) /
    Math.sqrt(1 + finiteSlope * finiteSlope)
  )
}

export function calculateTerrainSlope(
  travelMeters: number,
  input: Pick<TunePreviewInput, 'hillsEnabled' | 'hillHeightMeters' | 'hillSpacingMeters'>,
): number {
  if (!input.hillsEnabled) return 0
  const height = clamp(input.hillHeightMeters ?? 2.5, 0, 50)
  const spacing = clamp(input.hillSpacingMeters ?? 30, 2, 1000)
  const wave = (2 * Math.PI) / spacing
  const amplitude = height / 2
  return -amplitude * wave * Math.cos(travelMeters * wave)
}

export function calculateGroundToBoardAngleDegrees(
  boardAngleDegrees: number,
  terrainSlope: number,
): number {
  const terrainAngleDegrees = (Math.atan(finiteOrZero(terrainSlope)) * 180) / Math.PI
  return finiteOrZero(boardAngleDegrees) - terrainAngleDegrees
}

export function calculateTerrainLoadCurrentAmps(
  slope: number,
  physics?: TunePreviewAdvancedPhysics,
): number {
  const resolved = resolveTunePreviewPhysics(physics)
  const finiteSlope = finiteOrZero(slope)
  const gravityAlongSlope = terrainSlopeToSyntheticAcceleration(finiteSlope)
  const wheelRadiusMeters = (resolved.wheelDiameterInches * 0.0254) / 2
  const wheelTorqueNm = resolved.totalMassKg * gravityAlongSlope * wheelRadiusMeters
  return wheelTorqueNm / (resolved.motorTorqueNmPerAmp * resolved.drivetrainEfficiency)
}

export function calculateTerrainAtrDisturbance(
  slope: number,
  ampsToAccelerationRatio: number,
  physics?: TunePreviewAdvancedPhysics,
): number {
  return calculateTerrainLoadCurrentAmps(slope, physics) / Math.max(ampsToAccelerationRatio, 0.1)
}

export function calculatePreviewAcceleration(
  motorCurrentAmps: number,
  terrainSlope: number,
  physics?: TunePreviewAdvancedPhysics,
): number {
  const resolved = resolveTunePreviewPhysics(physics)
  const wheelRadiusMeters = (resolved.wheelDiameterInches * 0.0254) / 2
  const wheelForceNewtons =
    (clamp(motorCurrentAmps, -resolved.maxMotorCurrentAmps, resolved.maxMotorCurrentAmps) *
      resolved.motorTorqueNmPerAmp *
      resolved.drivetrainEfficiency) /
    wheelRadiusMeters
  const motorAcceleration = wheelForceNewtons / resolved.totalMassKg
  const gravityAcceleration = terrainSlopeToSyntheticAcceleration(terrainSlope)
  return (motorAcceleration - gravityAcceleration) * 3.6
}

function torqueTiltTarget(parameters: TunePreviewParameters, currentAmps: number): number {
  const strength =
    currentAmps < 0 ? parameters.torqueTiltStrengthRegen : parameters.torqueTiltStrength
  const magnitude = Math.min(
    Math.max(Math.abs(currentAmps) - parameters.torqueTiltStartCurrent, 0) * strength,
    parameters.torqueTiltAngleLimit,
  )
  return Math.sign(currentAmps) * magnitude
}

function torqueTiltRate(
  current: number,
  target: number,
  parameters: TunePreviewParameters,
  erpm: number,
): number {
  let rate: number
  if (current * target < 0) {
    rate = Math.max(parameters.torqueTiltOffSpeed, parameters.torqueTiltOnSpeed)
  } else if (Math.abs(current) > Math.abs(target)) {
    rate = parameters.torqueTiltOffSpeed
  } else {
    rate = parameters.torqueTiltOnSpeed
  }
  return erpm < 500 ? rate / 2 : rate
}

function brakeTiltTarget(
  parameters: TunePreviewParameters,
  syntheticCurrentAmps: number,
  balanceOffsetDegrees: number,
  erpm: number,
): number {
  if (
    parameters.brakeTiltStrength <= 0 ||
    syntheticCurrentAmps * Math.sign(erpm) >= 0 ||
    Math.abs(erpm) <= 2000 ||
    Math.sign(balanceOffsetDegrees) === Math.sign(erpm)
  ) {
    return 0
  }
  const factor = -(0.5 + (20 - parameters.brakeTiltStrength) / 5)
  return balanceOffsetDegrees / factor
}

export function calculateLongitudinalTarget(
  state: Pick<TunePreviewState, 'angleDegrees' | 'torqueTiltDegrees' | 'brakeTiltDegrees'>,
  parameters: TunePreviewParameters,
  input: TunePreviewInput,
  elapsedSeconds: number,
  syntheticCurrentAmps: number,
): TunePreviewTarget {
  const erpm = speedKmhToErpm(input.speedKmh, input.advancedPhysics)
  const erpmMagnitude = Math.abs(erpm)
  const torqueTarget = torqueTiltTarget(parameters, syntheticCurrentAmps)
  const torqueRate = torqueTiltRate(
    state.torqueTiltDegrees,
    torqueTarget,
    parameters,
    erpmMagnitude,
  )
  const torqueTiltDegrees = moveTowards(
    state.torqueTiltDegrees,
    torqueTarget,
    torqueRate * elapsedSeconds,
  )

  const constantTiltbackDegrees =
    erpmMagnitude >= parameters.tiltbackConstantErpm ? parameters.tiltbackConstant : 0
  const variableProgress = Math.max(erpmMagnitude - parameters.tiltbackVariableErpm, 0) / 1000
  const variableMagnitude = Math.min(
    parameters.tiltbackVariable * variableProgress,
    Math.abs(parameters.tiltbackVariableMax),
  )
  const variableTiltbackDegrees = Math.sign(parameters.tiltbackVariableMax) * variableMagnitude
  // Refloat passes its base setpoint minus pitch into Brake Tilt before adding TT/ATR/Brake Tilt.
  const balanceOffsetDegrees =
    constantTiltbackDegrees + variableTiltbackDegrees - state.angleDegrees
  const brakeTarget = brakeTiltTarget(parameters, syntheticCurrentAmps, balanceOffsetDegrees, erpm)
  const brakeApplying = Math.abs(brakeTarget) > Math.abs(state.brakeTiltDegrees)
  const brakeRate = brakeApplying
    ? parameters.atrOnSpeed * 1.5
    : parameters.atrOffSpeed / Math.max(parameters.brakeTiltLingering, 1)
  const lowSpeedBrakeRate = erpmMagnitude < 800 ? parameters.atrOnSpeed : brakeRate
  const brakeTiltDegrees = moveTowards(
    state.brakeTiltDegrees,
    brakeTarget,
    lowSpeedBrakeRate * (erpmMagnitude < 500 ? 0.5 : 1) * elapsedSeconds,
  )

  const totalDegrees = clamp(
    torqueTiltDegrees + brakeTiltDegrees + constantTiltbackDegrees + variableTiltbackDegrees,
    -MAX_ANGLE_DEGREES,
    MAX_ANGLE_DEGREES,
  )

  return {
    torqueTiltDegrees,
    brakeTiltDegrees,
    atrDegrees: 0,
    constantTiltbackDegrees,
    variableTiltbackDegrees,
    totalDegrees,
    syntheticCurrentAmps,
    erpm,
  }
}

export function calculateControllerCurrentAmps(
  angleDegrees: number,
  angularRateDegreesPerSecond: number,
  integralError: number,
  targetAngleDegrees: number,
  parameters: Pick<TunePreviewParameters, 'kp' | 'kp2' | 'kpBrake' | 'kp2Brake'>,
  currentLimitAmps = MAX_SYNTHETIC_CURRENT_AMPS,
): number {
  const error = targetAngleDegrees - angleDegrees
  const p = error * parameters.kp
  const rateP = -angularRateDegreesPerSecond * parameters.kp2
  const scaledP = p * (p > 0 ? 1 : parameters.kpBrake)
  const scaledRateP = rateP * (rateP > 0 ? 1 : parameters.kp2Brake)
  const currentAmps = clamp(
    scaledP + integralError + scaledRateP,
    -currentLimitAmps,
    currentLimitAmps,
  )
  return currentAmps === 0 ? 0 : currentAmps
}

/** Refloat v1.2.1 ATR expected acceleration, including its fixed 8 A rolling offset. */

export function calculateAtrExpectedAcceleration(
  filteredCurrentAmps: number,
  erpmSign: number,
  ampsToAccelerationRatio: number,
): number {
  const ratio = Math.max(ampsToAccelerationRatio, 0.1)
  const sign = Math.sign(filteredCurrentAmps)
  const absCurrent = Math.abs(filteredCurrentAmps)
  if (absCurrent < 25) return (filteredCurrentAmps - Math.sign(erpmSign) * 8) / ratio
  return (sign * 25 - Math.sign(erpmSign) * 8) / ratio + (sign * (absCurrent - 25)) / (ratio * 1.3)
}

/** Refloat combines same-direction Torque Tilt and ATR/Brake Tilt using the larger value. */

export function aggregateTorqueAndAdaptiveTilt(
  torqueTiltDegrees: number,
  adaptiveTiltDegrees: number,
): number {
  if (
    torqueTiltDegrees !== 0 &&
    adaptiveTiltDegrees !== 0 &&
    Math.sign(torqueTiltDegrees) === Math.sign(adaptiveTiltDegrees)
  ) {
    return (
      Math.sign(adaptiveTiltDegrees) *
      Math.max(Math.abs(adaptiveTiltDegrees), Math.abs(torqueTiltDegrees))
    )
  }
  return torqueTiltDegrees + adaptiveTiltDegrees
}

export function calculatePhysicalPitchAcceleration(
  angularRateDegreesPerSecond: number,
  longitudinalAccelerationMetersPerSecondSquared: number,
  physics: TunePreviewAdvancedPhysics,
): number {
  const angularAccelerationRadians =
    (longitudinalAccelerationMetersPerSecondSquared * BALANCE_PITCH_AUTHORITY) /
    physics.centerOfMassHeightMeters
  return (
    (angularAccelerationRadians * 180) / Math.PI -
    physics.pitchDampingPerSecond * angularRateDegreesPerSecond
  )
}
