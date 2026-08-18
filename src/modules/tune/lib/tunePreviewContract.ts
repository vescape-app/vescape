'worklet'

// Longitudinal target equations and transition signs derive from Refloat v1.2.1
// torque_tilt.c and brake_tilt.c (GPL-3.0-or-later), matching the bundled schema.

export const TUNE_PREVIEW_MODEL_VERSION = 'refloat-bundled-legacy-v18' as const
export const REFERENCE_ERPM_PER_KMH = 1000 / 3.5
export const MAX_TUNE_PREVIEW_SPEED_KMH = 50
export const TUNE_PREVIEW_RESET_SPEED_KMH = 15
export const COMPARATIVE_ACCELERATION_KMH_PER_SECOND = 6
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

export const MAX_ANGLE_DEGREES = 35

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
