'worklet'
import type { TuneProfileFieldValue } from 'vescape-core'

import {
  GROUND_TICK_SPACING_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
} from '@/modules/tune/lib/tunePreviewGeometry'
import { calculatePitchAcceleration } from '@/modules/tune/lib/tunePreviewResponse'

// Longitudinal target equations and transition signs derive from Refloat v1.2.1
// torque_tilt.c and brake_tilt.c (GPL-3.0-or-later), matching the bundled schema.

export const TUNE_PREVIEW_MODEL_VERSION = 'refloat-bundled-legacy-v18' as const
export const REFERENCE_ERPM_PER_KMH = 1000 / 3.5
export const MAX_TUNE_PREVIEW_SPEED_KMH = 50
export const TUNE_PREVIEW_RESET_SPEED_KMH = 15
export const MAX_SYNTHETIC_CURRENT_AMPS = 60
// A typical Refloat kp of 20 reaches the 60 A preview limit at 3 degrees of error.
// A wider gesture range makes most of the control indistinguishable current saturation.
export const MAX_PITCH_INPUT_DEGREES = 3
export const MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND = 130

export type TunePreviewMotorPresetId =
  | 'hypercore'
  | 'superflux-hs'
  | 'superflux-ht'
  | 'cannoncore-v2'
  | 'cannoncore-v3'

export interface TunePreviewAdvancedPhysics {
  motorPresetId: TunePreviewMotorPresetId
  totalMassKg: number
  motorTorqueNmPerAmp: number
  wheelDiameterInches: number
  motorPoleCount: number
  drivetrainEfficiency: number
  centerOfMassHeightMeters: number
  pitchDampingPerSecond: number
  maxMotorCurrentAmps: number
}

export const TUNE_PREVIEW_MOTOR_PRESETS: Record<
  TunePreviewMotorPresetId,
  { label: string; motorTorqueNmPerAmp: number }
> = {
  hypercore: { label: 'FM Hypercore', motorTorqueNmPerAmp: 0.68 },
  'superflux-hs': { label: 'SuperFlux HS', motorTorqueNmPerAmp: 0.56 },
  'superflux-ht': { label: 'SuperFlux HT', motorTorqueNmPerAmp: 0.75 },
  'cannoncore-v2': { label: 'CannonCore V2', motorTorqueNmPerAmp: 0.68 },
  'cannoncore-v3': { label: 'CannonCore V3', motorTorqueNmPerAmp: 0.75 },
}

export const DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS: TunePreviewAdvancedPhysics = {
  motorPresetId: 'hypercore',
  totalMassKg: 88,
  motorTorqueNmPerAmp: TUNE_PREVIEW_MOTOR_PRESETS.hypercore.motorTorqueNmPerAmp,
  wheelDiameterInches: 11,
  motorPoleCount: 30,
  drivetrainEfficiency: 0.85,
  centerOfMassHeightMeters: 0.9,
  pitchDampingPerSecond: 30,
  maxMotorCurrentAmps: 60,
}

const REQUIRED_FIELDS = [
  'kp',
  'kp2',
  'ki',
  'mahony_kp',
  'torquetilt_strength',
  'torquetilt_strength_regen',
  'torquetilt_start_current',
  'torquetilt_angle_limit',
  'torquetilt_on_speed',
  'torquetilt_off_speed',
  'braketilt_strength',
  'braketilt_lingering',
  'atr_on_speed',
  'atr_off_speed',
  'atr_strength_up',
  'atr_strength_down',
  'atr_threshold_up',
  'atr_threshold_down',
  'atr_speed_boost',
  'atr_angle_limit',
  'atr_response_boost',
  'atr_transition_boost',
  'atr_filter',
  'atr_amps_accel_ratio',
  'atr_amps_decel_ratio',
  'tiltback_constant',
  'tiltback_variable',
  'tiltback_variable_max',
] as const

const LEGACY_PROFILE_DEFAULTS = {
  kp_brake: 1,
  kp2_brake: 1,
  ki_limit: 30,
  tiltback_constant_erpm: 500,
  tiltback_variable_erpm: 0,
} as const

const MAX_ELAPSED_SECONDS = 0.25
const REFLOAT_LOOP_HZ = 832
const STEP_SECONDS = 1 / REFLOAT_LOOP_HZ
const MAX_ANGLE_DEGREES = 35
const MAX_RATE_DEGREES_PER_SECOND = 120
const STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665
const PITCH_INPUT_RESPONSE_PER_SECOND = 12
const BALANCE_PITCH_AUTHORITY = 9

export interface TunePreviewParameters {
  modelVersion: typeof TUNE_PREVIEW_MODEL_VERSION
  kp: number
  kp2: number
  ki: number
  kpBrake: number
  kp2Brake: number
  kiLimit: number
  mahonyKp: number
  torqueTiltStrength: number
  torqueTiltStrengthRegen: number
  torqueTiltStartCurrent: number
  torqueTiltAngleLimit: number
  torqueTiltOnSpeed: number
  torqueTiltOffSpeed: number
  brakeTiltStrength: number
  brakeTiltLingering: number
  atrOnSpeed: number
  atrOffSpeed: number
  atrStrengthUp: number
  atrStrengthDown: number
  atrThresholdUp: number
  atrThresholdDown: number
  atrSpeedBoost: number
  atrAngleLimit: number
  atrResponseBoost: number
  atrTransitionBoost: number
  atrFilter: number
  atrAmpsAccelRatio: number
  atrAmpsDecelRatio: number
  tiltbackConstant: number
  tiltbackConstantErpm: number
  tiltbackVariable: number
  tiltbackVariableMax: number
  tiltbackVariableErpm: number
}

export type TunePreviewModel =
  | { status: 'ready'; parameters: TunePreviewParameters; assumedFields: string[] }
  | {
      status: 'unsupported'
      modelVersion: typeof TUNE_PREVIEW_MODEL_VERSION
      missingFields: string[]
    }

export interface TunePreviewTarget {
  torqueTiltDegrees: number
  brakeTiltDegrees: number
  atrDegrees: number
  constantTiltbackDegrees: number
  variableTiltbackDegrees: number
  totalDegrees: number
  syntheticCurrentAmps: number
  erpm: number
}

export interface TunePreviewState {
  syntheticSpeedKmh: number
  angleDegrees: number
  angularRateDegreesPerSecond: number
  pitchInputRateDegreesPerSecond: number
  integralError: number
  targetAngleDegrees: number
  torqueTiltDegrees: number
  brakeTiltDegrees: number
  atrDegrees: number
  constantTiltbackDegrees: number
  variableTiltbackDegrees: number
  syntheticCurrentAmps: number
  filteredCurrentAmps: number
  erpm: number
  groundTravelMeters: number
  terrainSlope: number
  terrainLoadCurrentAmps: number
  atrAccelDiff: number
  atrTargetDegrees: number
  measuredAccelerationErpmPerTick: number
}

export interface TunePreviewInput {
  pitchInputDegrees: number
  pitchInputActive?: boolean
  /** Rider pressure represented by a damped pitch moment, never an imposed Board angle. */
  riderLeanAngleDegrees?: number
  riderLoadCurrentAmps?: number
  speedKmh: number
  hillsEnabled?: boolean
  hillHeightMeters?: number
  hillSpacingMeters?: number
  advancedPhysics?: TunePreviewAdvancedPhysics
  paused?: boolean
}

function numberField(fields: Record<string, TuneProfileFieldValue>, id: string): number {
  return fields[id] as number
}

function numberFieldOrDefault(
  fields: Record<string, TuneProfileFieldValue>,
  id: string,
  fallback: number,
): number {
  const value = fields[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function boundedSpeed(speedKmh: number): number {
  return Number.isFinite(speedKmh)
    ? clamp(speedKmh, -MAX_TUNE_PREVIEW_SPEED_KMH, MAX_TUNE_PREVIEW_SPEED_KMH)
    : 0
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0 || current === target) return current
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

export function createTunePreviewModel(
  fields: Record<string, TuneProfileFieldValue>,
): TunePreviewModel {
  const missingFields = REQUIRED_FIELDS.filter((id) => {
    const value = fields[id]
    return typeof value !== 'number' || !Number.isFinite(value)
  })

  if (missingFields.length > 0) {
    return { status: 'unsupported', modelVersion: TUNE_PREVIEW_MODEL_VERSION, missingFields }
  }

  const assumedFields = Object.keys(LEGACY_PROFILE_DEFAULTS).filter((id) => {
    const value = fields[id]
    return typeof value !== 'number' || !Number.isFinite(value)
  })

  return {
    status: 'ready',
    assumedFields,
    parameters: {
      modelVersion: TUNE_PREVIEW_MODEL_VERSION,
      kp: numberField(fields, 'kp'),
      kp2: numberField(fields, 'kp2'),
      ki: numberField(fields, 'ki'),
      kpBrake: numberFieldOrDefault(fields, 'kp_brake', LEGACY_PROFILE_DEFAULTS.kp_brake),
      kp2Brake: numberFieldOrDefault(fields, 'kp2_brake', LEGACY_PROFILE_DEFAULTS.kp2_brake),
      kiLimit: numberFieldOrDefault(fields, 'ki_limit', LEGACY_PROFILE_DEFAULTS.ki_limit),
      mahonyKp: numberField(fields, 'mahony_kp'),
      torqueTiltStrength: numberField(fields, 'torquetilt_strength'),
      torqueTiltStrengthRegen: numberField(fields, 'torquetilt_strength_regen'),
      torqueTiltStartCurrent: numberField(fields, 'torquetilt_start_current'),
      torqueTiltAngleLimit: numberField(fields, 'torquetilt_angle_limit'),
      torqueTiltOnSpeed: numberField(fields, 'torquetilt_on_speed'),
      torqueTiltOffSpeed: numberField(fields, 'torquetilt_off_speed'),
      brakeTiltStrength: numberField(fields, 'braketilt_strength'),
      brakeTiltLingering: numberField(fields, 'braketilt_lingering'),
      atrOnSpeed: numberField(fields, 'atr_on_speed'),
      atrOffSpeed: numberField(fields, 'atr_off_speed'),
      atrStrengthUp: numberField(fields, 'atr_strength_up'),
      atrStrengthDown: numberField(fields, 'atr_strength_down'),
      atrThresholdUp: numberField(fields, 'atr_threshold_up'),
      atrThresholdDown: numberField(fields, 'atr_threshold_down'),
      atrSpeedBoost: numberField(fields, 'atr_speed_boost'),
      atrAngleLimit: numberField(fields, 'atr_angle_limit'),
      atrResponseBoost: numberField(fields, 'atr_response_boost'),
      atrTransitionBoost: numberField(fields, 'atr_transition_boost'),
      atrFilter: numberField(fields, 'atr_filter'),
      atrAmpsAccelRatio: numberField(fields, 'atr_amps_accel_ratio'),
      atrAmpsDecelRatio: numberField(fields, 'atr_amps_decel_ratio'),
      tiltbackConstant: numberField(fields, 'tiltback_constant'),
      tiltbackConstantErpm: numberFieldOrDefault(
        fields,
        'tiltback_constant_erpm',
        LEGACY_PROFILE_DEFAULTS.tiltback_constant_erpm,
      ),
      tiltbackVariable: numberField(fields, 'tiltback_variable'),
      tiltbackVariableMax: numberField(fields, 'tiltback_variable_max'),
      tiltbackVariableErpm: numberFieldOrDefault(
        fields,
        'tiltback_variable_erpm',
        LEGACY_PROFILE_DEFAULTS.tiltback_variable_erpm,
      ),
    },
  }
}

export function resolveTunePreviewPhysics(
  physics?: Partial<TunePreviewAdvancedPhysics>,
): TunePreviewAdvancedPhysics {
  const motorPresetId =
    physics?.motorPresetId && physics.motorPresetId in TUNE_PREVIEW_MOTOR_PRESETS
      ? physics.motorPresetId
      : DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.motorPresetId
  return {
    motorPresetId,
    totalMassKg: clampFinite(physics?.totalMassKg ?? Number.NaN, 30, 250, 88),
    motorTorqueNmPerAmp: clampFinite(
      physics?.motorTorqueNmPerAmp ?? Number.NaN,
      0.2,
      1.5,
      TUNE_PREVIEW_MOTOR_PRESETS[motorPresetId].motorTorqueNmPerAmp,
    ),
    wheelDiameterInches: clampFinite(
      physics?.wheelDiameterInches ?? Number.NaN,
      8,
      20,
      DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.wheelDiameterInches,
    ),
    motorPoleCount: Math.round(
      clampFinite(
        physics?.motorPoleCount ?? Number.NaN,
        2,
        60,
        DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.motorPoleCount,
      ),
    ),
    drivetrainEfficiency: clampFinite(
      physics?.drivetrainEfficiency ?? Number.NaN,
      0.5,
      1,
      DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.drivetrainEfficiency,
    ),
    centerOfMassHeightMeters: clampFinite(
      physics?.centerOfMassHeightMeters ?? Number.NaN,
      0.4,
      1.5,
      DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.centerOfMassHeightMeters,
    ),
    pitchDampingPerSecond: clampFinite(
      physics?.pitchDampingPerSecond ?? Number.NaN,
      0,
      30,
      DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.pitchDampingPerSecond,
    ),
    maxMotorCurrentAmps: clampFinite(
      physics?.maxMotorCurrentAmps ?? Number.NaN,
      10,
      150,
      DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.maxMotorCurrentAmps,
    ),
  }
}

export function speedKmhToErpm(
  speedKmh: number,
  physics?: Partial<TunePreviewAdvancedPhysics>,
): number {
  const resolved = resolveTunePreviewPhysics(physics)
  const setupErpmPerKmh =
    REFERENCE_ERPM_PER_KMH *
    (resolved.motorPoleCount / DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.motorPoleCount) *
    (DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS.wheelDiameterInches / resolved.wheelDiameterInches)
  return clamp(speedKmh, -MAX_TUNE_PREVIEW_SPEED_KMH, MAX_TUNE_PREVIEW_SPEED_KMH) * setupErpmPerKmh
}

export function speedKmhToReferenceErpm(speedKmh: number): number {
  return (
    clamp(speedKmh, -MAX_TUNE_PREVIEW_SPEED_KMH, MAX_TUNE_PREVIEW_SPEED_KMH) *
    REFERENCE_ERPM_PER_KMH
  )
}

export function groundTravelToVisualOffset(groundTravelMeters: number): number {
  const tickSpacingPixels = GROUND_TICK_SPACING_METERS * TUNE_PREVIEW_PIXELS_PER_METER
  return (groundTravelMeters * TUNE_PREVIEW_PIXELS_PER_METER) % tickSpacingPixels
}

export function pitchInputControlToRate(controlDegrees: number): number {
  const normalized =
    clampFinite(controlDegrees, -MAX_PITCH_INPUT_DEGREES, MAX_PITCH_INPUT_DEGREES, 0) /
    MAX_PITCH_INPUT_DEGREES
  const magnitude = Math.abs(normalized)
  const easedMagnitude = 1 - (1 - magnitude) ** 2
  return Math.sign(normalized) * easedMagnitude * MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND
}

export function pitchInputRateToControlDegrees(rateDegreesPerSecond: number): number {
  'worklet'
  const normalizedRate =
    clampFinite(
      rateDegreesPerSecond,
      -MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
      MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
      0,
    ) / MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND
  const magnitude = Math.abs(normalizedRate)
  const normalizedControl = 1 - Math.sqrt(1 - magnitude)
  return Math.sign(normalizedRate) * normalizedControl * MAX_PITCH_INPUT_DEGREES
}

export function createTunePreviewState(speedKmh = 0): TunePreviewState {
  const syntheticSpeedKmh = boundedSpeed(speedKmh)
  return {
    syntheticSpeedKmh,
    angleDegrees: 0,
    angularRateDegreesPerSecond: 0,
    pitchInputRateDegreesPerSecond: 0,
    integralError: 0,
    targetAngleDegrees: 0,
    torqueTiltDegrees: 0,
    brakeTiltDegrees: 0,
    atrDegrees: 0,
    constantTiltbackDegrees: 0,
    variableTiltbackDegrees: 0,
    syntheticCurrentAmps: 0,
    filteredCurrentAmps: 0,
    erpm: speedKmhToReferenceErpm(syntheticSpeedKmh),
    groundTravelMeters: 0,
    terrainSlope: 0,
    terrainLoadCurrentAmps: 0,
    atrAccelDiff: 0,
    atrTargetDegrees: 0,
    measuredAccelerationErpmPerTick: 0,
  }
}

export function resetTunePreviewSpeed(
  state: TunePreviewState,
  speedKmh: number,
  physics?: Partial<TunePreviewAdvancedPhysics>,
): TunePreviewState {
  const syntheticSpeedKmh = boundedSpeed(speedKmh)
  return {
    ...state,
    syntheticSpeedKmh,
    erpm: speedKmhToErpm(syntheticSpeedKmh, physics),
    measuredAccelerationErpmPerTick: 0,
  }
}

export function holdTunePreviewSpeed(
  state: TunePreviewState,
  speedKmh: number,
  physics?: Partial<TunePreviewAdvancedPhysics>,
): TunePreviewState {
  const syntheticSpeedKmh = boundedSpeed(speedKmh)
  return { ...state, syntheticSpeedKmh, erpm: speedKmhToErpm(syntheticSpeedKmh, physics) }
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

function stepFixed(
  state: TunePreviewState,
  parameters: TunePreviewParameters,
  input: TunePreviewInput,
  dt: number,
): TunePreviewState {
  const physics = resolveTunePreviewPhysics(input.advancedPhysics)
  const pitchInputActive = input.pitchInputActive === true
  const requestedPitchInputRateDegreesPerSecond = pitchInputActive
    ? pitchInputControlToRate(input.pitchInputDegrees)
    : 0
  const previousPitchInputRateDegreesPerSecond = Number.isFinite(
    state.pitchInputRateDegreesPerSecond,
  )
    ? state.pitchInputRateDegreesPerSecond
    : 0
  const pitchInputRateDegreesPerSecond = pitchInputActive
    ? previousPitchInputRateDegreesPerSecond +
      (requestedPitchInputRateDegreesPerSecond - previousPitchInputRateDegreesPerSecond) *
        (1 - Math.exp(-PITCH_INPUT_RESPONSE_PER_SECOND * dt))
    : 0
  const controlledAngleDegrees = state.angleDegrees
  const controlledRateDegreesPerSecond =
    state.angularRateDegreesPerSecond + pitchInputRateDegreesPerSecond
  const currentLimit = physics.maxMotorCurrentAmps
  const balanceCurrentAmps = calculateControllerCurrentAmps(
    controlledAngleDegrees,
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
  const effectiveInput = { ...input, speedKmh: syntheticSpeedKmh, advancedPhysics: physics }
  const target = calculateLongitudinalTarget(
    state,
    parameters,
    effectiveInput,
    dt,
    filteredCurrentAmps,
  )
  const braking =
    syntheticSpeedKmh === 0 ? filteredCurrentAmps < 0 : filteredCurrentAmps * syntheticSpeedKmh < 0
  const ratio = Math.max(braking ? parameters.atrAmpsDecelRatio : parameters.atrAmpsAccelRatio, 0.1)
  const erpmSign = target.erpm === 0 ? 0 : Math.sign(syntheticSpeedKmh || 1)
  const expectedAcceleration = calculateAtrExpectedAcceleration(
    filteredCurrentAmps,
    erpmSign,
    ratio,
  )
  const rawAccelDiff = expectedAcceleration - state.measuredAccelerationErpmPerTick
  const targetErpmMagnitude = Math.abs(target.erpm)
  const accelDiffAlpha =
    targetErpmMagnitude > 2000
      ? 0.1
      : targetErpmMagnitude > 1000
        ? 0.05
        : targetErpmMagnitude > 250
          ? 0.02
          : 1
  const atrAccelDiff =
    targetErpmMagnitude > 250
      ? state.atrAccelDiff + (rawAccelDiff - state.atrAccelDiff) * accelDiffAlpha
      : 0
  let atrStrength = atrAccelDiff >= 0 ? parameters.atrStrengthUp : parameters.atrStrengthDown
  if (targetErpmMagnitude > 3000 && !braking) {
    const span =
      Math.abs(parameters.atrSpeedBoost) > 0.4
        ? (Math.abs(parameters.atrSpeedBoost) - 0.4) * 5000 + 3000
        : 3000
    atrStrength *= 1 + Math.min(1, (targetErpmMagnitude - 3000) / span) * parameters.atrSpeedBoost
  }
  const threshold = braking ? parameters.atrThresholdDown : parameters.atrThresholdUp
  const rawAtr = atrStrength * atrAccelDiff
  const thresholded = Math.abs(rawAtr) < threshold ? 0 : rawAtr - Math.sign(rawAtr) * threshold
  const atrTargetDegrees = clamp(
    state.atrTargetDegrees * 0.95 + thresholded * 0.05,
    -parameters.atrAngleLimit,
    parameters.atrAngleLimit,
  )
  let atrRate =
    Math.abs(atrTargetDegrees) > Math.abs(state.atrDegrees)
      ? parameters.atrOnSpeed
      : parameters.atrOffSpeed
  if (
    state.atrDegrees * atrTargetDegrees < 0 &&
    Math.abs(atrTargetDegrees - state.atrDegrees) > 2
  ) {
    atrRate *= parameters.atrTransitionBoost
  }
  if (targetErpmMagnitude > 2500) atrRate *= parameters.atrResponseBoost
  if (targetErpmMagnitude > 6000) atrRate *= parameters.atrResponseBoost
  const atrDegrees = moveTowards(state.atrDegrees, atrTargetDegrees, atrRate * dt)
  target.atrDegrees = atrDegrees
  const adaptiveDegrees = atrDegrees + target.brakeTiltDegrees
  const torqueAndAdaptiveDegrees = aggregateTorqueAndAdaptiveTilt(
    target.torqueTiltDegrees,
    adaptiveDegrees,
  )
  target.totalDegrees = clamp(
    torqueAndAdaptiveDegrees + target.constantTiltbackDegrees + target.variableTiltbackDegrees,
    -MAX_ANGLE_DEGREES,
    MAX_ANGLE_DEGREES,
  )
  const pidError = target.totalDegrees - controlledAngleDegrees
  const integralLimit = parameters.kiLimit > 0 ? parameters.kiLimit : Number.POSITIVE_INFINITY
  const integralError = clamp(
    state.integralError + pidError * parameters.ki,
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
      : finiteOrZero(input.riderLeanAngleDegrees) - controlledAngleDegrees,
    controlledRateDegreesPerSecond,
    physics.pitchDampingPerSecond,
  )
  const angularRateDegreesPerSecond = clamp(
    state.angularRateDegreesPerSecond + angularAcceleration * dt,
    -MAX_RATE_DEGREES_PER_SECOND,
    MAX_RATE_DEGREES_PER_SECOND,
  )
  const angleDegrees = clamp(
    controlledAngleDegrees + (angularRateDegreesPerSecond + pitchInputRateDegreesPerSecond) * dt,
    -MAX_ANGLE_DEGREES,
    MAX_ANGLE_DEGREES,
  )

  const erpm = speedKmhToErpm(syntheticSpeedKmh, physics)
  const erpmDelta = erpm - state.erpm
  const measuredAccelerationErpmPerTick =
    state.measuredAccelerationErpmPerTick + (erpmDelta - state.measuredAccelerationErpmPerTick) / 40

  return {
    syntheticSpeedKmh,
    angleDegrees: finiteOrZero(angleDegrees),
    angularRateDegreesPerSecond: finiteOrZero(angularRateDegreesPerSecond),
    pitchInputRateDegreesPerSecond: finiteOrZero(pitchInputRateDegreesPerSecond),
    integralError: finiteOrZero(integralError),
    targetAngleDegrees: target.totalDegrees,
    torqueTiltDegrees: target.torqueTiltDegrees,
    brakeTiltDegrees: target.brakeTiltDegrees,
    atrDegrees,
    constantTiltbackDegrees: target.constantTiltbackDegrees,
    variableTiltbackDegrees: target.variableTiltbackDegrees,
    syntheticCurrentAmps: finiteOrZero(syntheticCurrentAmps),
    filteredCurrentAmps: finiteOrZero(filteredCurrentAmps),
    erpm,
    groundTravelMeters: state.groundTravelMeters + (syntheticSpeedKmh / 3.6) * dt,
    terrainSlope,
    terrainLoadCurrentAmps,
    atrAccelDiff,
    atrTargetDegrees,
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
