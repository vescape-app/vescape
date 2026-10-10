'worklet'
import type { TuneProfileFieldValue } from 'vescape-core'

import {
  GROUND_TICK_SPACING_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
} from '@/modules/tune/lib/tunePreviewGeometry'
import {
  DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  MAX_PITCH_INPUT_DEGREES,
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
  MAX_TUNE_PREVIEW_SPEED_KMH,
  REFERENCE_ERPM_PER_KMH,
  TUNE_PREVIEW_MODEL_VERSION,
  TUNE_PREVIEW_MOTOR_PRESETS,
  type TunePreviewAdvancedPhysics,
  type TunePreviewModel,
  type TunePreviewState,
} from '@/modules/tune/lib/tunePreviewContract'
import { clamp, clampFinite } from '@/modules/tune/lib/tunePreviewMath'

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

export function boundedSpeed(speedKmh: number): number {
  return Number.isFinite(speedKmh)
    ? clamp(speedKmh, -MAX_TUNE_PREVIEW_SPEED_KMH, MAX_TUNE_PREVIEW_SPEED_KMH)
    : 0
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
