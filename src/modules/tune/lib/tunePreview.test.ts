import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  MAX_PITCH_INPUT_DEGREES,
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
  MAX_TUNE_PREVIEW_SPEED_KMH,
  TUNE_PREVIEW_MOTOR_PRESETS,
  aggregateTorqueAndAdaptiveTilt,
  calculateAtrExpectedAcceleration,
  calculateControllerCurrentAmps,
  calculateGroundToBoardAngleDegrees,
  calculateLongitudinalTarget,
  calculatePreviewAcceleration,
  calculateSyntheticAcceleration,
  calculateTerrainAtrDisturbance,
  calculateTerrainLoadCurrentAmps,
  calculateTerrainSlope,
  createTunePreviewModel,
  createTunePreviewState,
  groundTravelToVisualOffset,
  pitchInputControlToRate,
  pitchInputRateToControlDegrees,
  resetTunePreviewSpeed,
  resolveTunePreviewPhysics,
  speedKmhToErpm,
  speedKmhToReferenceErpm,
  stepTunePreview,
  terrainSlopeToSyntheticAcceleration,
} from '@/modules/tune/lib/tunePreview'
import { terrainHeightRelativeToWheel } from '@/modules/tune/lib/tunePreviewGeometry'

const baseFields = {
  kp: 20,
  kp2: 0.6,
  ki: 0.02,
  kp_brake: 1,
  kp2_brake: 1,
  ki_limit: 30,
  mahony_kp: 2,
  torquetilt_strength: 0.1,
  torquetilt_strength_regen: 0.12,
  torquetilt_start_current: 15,
  torquetilt_angle_limit: 8,
  torquetilt_on_speed: 10,
  torquetilt_off_speed: 8,
  braketilt_strength: 10,
  braketilt_lingering: 2,
  atr_on_speed: 10,
  atr_off_speed: 8,
  atr_strength_up: 1.5,
  atr_strength_down: 1.5,
  atr_threshold_up: 1,
  atr_threshold_down: 1,
  atr_speed_boost: 0.3,
  atr_angle_limit: 8,
  atr_response_boost: 1.5,
  atr_transition_boost: 1.5,
  atr_filter: 5,
  atr_amps_accel_ratio: 8,
  atr_amps_decel_ratio: 8,
  tiltback_constant: 1,
  tiltback_constant_erpm: 500,
  tiltback_variable: 0.3,
  tiltback_variable_max: 3,
  tiltback_variable_erpm: 1000,
}

function readyParameters(fields: typeof baseFields = baseFields) {
  const model = createTunePreviewModel(fields)
  if (model.status !== 'ready') throw new Error('expected supported model')
  return model.parameters
}

function disturbThenRecover(
  fields: typeof baseFields,
  pitchInputDegrees = 10,
  recoverySeconds = 1,
) {
  const parameters = readyParameters(fields)
  let state = stepTunePreview(
    createTunePreviewState(15),
    parameters,
    {
      pitchInputDegrees: pitchInputDegrees,
      pitchInputActive: true,
      speedKmh: 15,
    },
    1 / 60,
  )
  for (let elapsed = 0; elapsed < recoverySeconds; elapsed += 1 / 60) {
    state = stepTunePreview(
      state,
      parameters,
      { pitchInputDegrees: 0, pitchInputActive: false, speedKmh: 15 },
      1 / 60,
    )
  }
  return state
}

describe('Tune Preview longitudinal response', () => {
  test('repeats the same Pitch Input and recovery deterministically', () => {
    expect(disturbThenRecover(baseFields)).toEqual(disturbThenRecover(baseFields))
  })

  test('Nose Pitch Input accumulates angle error without constraining Board', () => {
    const parameters = readyParameters()
    const state = stepTunePreview(
      createTunePreviewState(15),
      parameters,
      {
        pitchInputDegrees: -MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 15,
      },
      0.1,
    )
    expect(state.angleDegrees - state.targetAngleDegrees).toBeLessThan(0)
    expect(state.angularRateDegreesPerSecond).not.toBe(0)
    expect(state.syntheticCurrentAmps).toBeGreaterThan(0)
  })

  test('larger slider displacement adds angle error faster', () => {
    const parameters = readyParameters()
    const half = stepTunePreview(
      createTunePreviewState(),
      parameters,
      {
        pitchInputDegrees: -MAX_PITCH_INPUT_DEGREES * 0.5,
        pitchInputActive: true,
        speedKmh: 0,
      },
      1 / 120,
    )
    const full = stepTunePreview(
      createTunePreviewState(),
      parameters,
      {
        pitchInputDegrees: -MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      1 / 120,
    )

    expect(full.angleDegrees).toBeLessThan(half.angleDegrees)
  })

  test('smooths abrupt Pitch Input changes before they reach the controller', () => {
    const parameters = readyParameters()
    const firstFrame = stepTunePreview(
      createTunePreviewState(),
      parameters,
      {
        pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      1 / 60,
    )
    const settled = stepTunePreview(
      firstFrame,
      parameters,
      {
        pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      0.25,
    )
    const released = stepTunePreview(
      settled,
      parameters,
      { pitchInputDegrees: 0, pitchInputActive: false, speedKmh: 0 },
      1 / 60,
    )

    expect(firstFrame.pitchInputRateDegreesPerSecond).toBeGreaterThan(0)
    expect(firstFrame.pitchInputRateDegreesPerSecond).toBeLessThan(
      MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
    )
    expect(settled.pitchInputRateDegreesPerSecond).toBeGreaterThan(
      MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND * 0.95,
    )
    expect(released.pitchInputRateDegreesPerSecond).toBe(0)
  })

  test('front-loads Pitch Input response for easier control around center', () => {
    const parameters = readyParameters()
    const responseAt = (control: number) =>
      stepTunePreview(
        createTunePreviewState(),
        parameters,
        {
          pitchInputDegrees: control,
          pitchInputActive: true,
          speedKmh: 0,
        },
        0.25,
      ).pitchInputRateDegreesPerSecond

    const half = responseAt(MAX_PITCH_INPUT_DEGREES * 0.5)
    const full = responseAt(MAX_PITCH_INPUT_DEGREES)
    const negativeHalf = responseAt(-MAX_PITCH_INPUT_DEGREES * 0.5)

    expect(half / full).toBeGreaterThan(0.7)
    expect(negativeHalf).toBeCloseTo(-half)
  })

  test('maps requested Pitch Input rates back to slider control values', () => {
    const controls = [
      -MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
      -125,
      0,
      125,
      MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
    ].map(pitchInputRateToControlDegrees)

    expect(controls[0]).toBeCloseTo(-MAX_PITCH_INPUT_DEGREES)
    expect(controls[2]).toBe(0)
    expect(controls[4]).toBeCloseTo(MAX_PITCH_INPUT_DEGREES)
    expect(controls[1]).toBeLessThan(0)
    expect(controls[3]).toBeGreaterThan(0)
    expect(pitchInputControlToRate(controls[1])).toBeCloseTo(-125)
    expect(pitchInputControlToRate(controls[3])).toBeCloseTo(125)
  })

  test('recovers a pre-filter runtime state preserved by Fast Refresh', () => {
    const { pitchInputRateDegreesPerSecond: _, ...legacyState } = createTunePreviewState()
    const next = stepTunePreview(
      legacyState as unknown as ReturnType<typeof createTunePreviewState>,
      readyParameters(),
      {
        pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      0.1,
    )

    expect(next.pitchInputRateDegreesPerSecond).toBeGreaterThan(0)
    expect(next.angleDegrees).toBeGreaterThan(0)
  })

  test('clamps Pitch Input strength to the supported range', () => {
    const clamped = stepTunePreview(
      createTunePreviewState(),
      readyParameters(),
      { pitchInputDegrees: 90, pitchInputActive: true, speedKmh: 0 },
      0.1,
    )
    const maximum = stepTunePreview(
      createTunePreviewState(),
      readyParameters(),
      {
        pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      0.1,
    )
    expect(clamped).toEqual(maximum)
  })

  test('stops adding angle error on release and recovers without snapping', () => {
    const parameters = readyParameters()
    const held = stepTunePreview(
      createTunePreviewState(),
      parameters,
      {
        pitchInputDegrees: -MAX_PITCH_INPUT_DEGREES,
        pitchInputActive: true,
        speedKmh: 0,
      },
      0.5,
    )
    const released = stepTunePreview(
      held,
      parameters,
      { pitchInputDegrees: 0, pitchInputActive: false, speedKmh: 0 },
      0.25,
    )
    expect(Math.abs(released.angleDegrees - released.targetAngleDegrees)).toBeLessThan(
      Math.abs(held.angleDegrees - held.targetAngleDegrees),
    )
    expect(released.angleDegrees).not.toBe(released.targetAngleDegrees)
  })

  test('higher Aggressiveness reduces the same released Pitch Input faster', () => {
    const neutralTargets = {
      ...baseFields,
      torquetilt_strength: 0,
      torquetilt_strength_regen: 0,
      braketilt_strength: 0,
      atr_strength_up: 0,
      atr_strength_down: 0,
      tiltback_constant: 0,
      tiltback_variable: 0,
      tiltback_variable_max: 0,
    }
    const low = { ...neutralTargets, kp: 15, kp2: 0.4, ki: 0.015, mahony_kp: 2.2 }
    const high = { ...neutralTargets, kp: 30, kp2: 1.1, ki: 0.03, mahony_kp: 1.5 }
    const lowState = disturbThenRecover(low, 10, 1)
    const highState = disturbThenRecover(high, 10, 1)
    expect(Math.abs(highState.angleDegrees - highState.targetAngleDegrees)).toBeLessThan(
      Math.abs(lowState.angleDegrees - lowState.targetAngleDegrees),
    )
  })

  test('derives bounded controller current from angle, rate, integral, and tune', () => {
    const parameters = readyParameters()
    expect(calculateControllerCurrentAmps(0, 0, 0, 0, parameters)).toBe(0)
    expect(calculateControllerCurrentAmps(5, 0, 0, 0, parameters)).toBeLessThan(0)
    expect(calculateControllerCurrentAmps(-5, 0, 0, 0, parameters)).toBeGreaterThan(0)
    expect(calculateControllerCurrentAmps(100, 100, 20, 0, parameters)).toBe(-60)
  })

  test('uses Refloat braking multipliers and I term directly in motor amps', () => {
    const parameters = readyParameters({ ...baseFields, kp_brake: 0.5, kp2_brake: 0.5 })
    expect(calculateControllerCurrentAmps(2, 4, 3, 0, parameters)).toBeCloseTo(-18.2)
    expect(calculateControllerCurrentAmps(-2, -4, 3, 0, parameters)).toBeCloseTo(45.4)
  })

  test('matches Refloat ATR offset and nonlinear current region', () => {
    expect(calculateAtrExpectedAcceleration(0, 1, 8)).toBe(-1)
    expect(calculateAtrExpectedAcceleration(16, 1, 8)).toBe(1)
    expect(calculateAtrExpectedAcceleration(38, 1, 8)).toBeCloseTo(3.375)
  })

  test('uses max for same-direction TT and adaptive tilt, sum for opposite directions', () => {
    expect(aggregateTorqueAndAdaptiveTilt(3, 5)).toBe(5)
    expect(aggregateTorqueAndAdaptiveTilt(-6, -2)).toBe(-6)
    expect(aggregateTorqueAndAdaptiveTilt(-3, 5)).toBe(2)
  })

  test('maps controller current to the bounded comparative acceleration scale', () => {
    expect(calculateSyntheticAcceleration(60)).toBe(6)
    expect(calculateSyntheticAcceleration(-30)).toBe(-3)
    expect(calculateSyntheticAcceleration(100)).toBe(6)
  })

  test('Nose accelerates more than Tail through tune-derived controller effort', () => {
    const parameters = readyParameters()
    const tail = stepTunePreview(
      createTunePreviewState(15),
      parameters,
      {
        pitchInputDegrees: 10,
        pitchInputActive: true,
        speedKmh: 15,
      },
      0.25,
    )
    const nose = stepTunePreview(
      createTunePreviewState(15),
      parameters,
      {
        pitchInputDegrees: -10,
        pitchInputActive: true,
        speedKmh: 15,
      },
      0.25,
    )
    expect(nose.angleDegrees).toBeLessThan(tail.angleDegrees)
    expect(nose.syntheticSpeedKmh).toBeGreaterThan(tail.syntheticSpeedKmh)
  })

  test('dynamic speed responds proportionally across the pitch input control', () => {
    const parameters = readyParameters()
    const speedAfterPitchInput = (pitchInputDegrees: number) =>
      stepTunePreview(
        createTunePreviewState(15),
        parameters,
        {
          pitchInputDegrees,
          pitchInputActive: true,
          speedKmh: 15,
        },
        0.25,
      ).syntheticSpeedKmh

    const quarterNose = speedAfterPitchInput(-MAX_PITCH_INPUT_DEGREES * 0.25)
    const halfNose = speedAfterPitchInput(-MAX_PITCH_INPUT_DEGREES * 0.5)
    const fullNose = speedAfterPitchInput(-MAX_PITCH_INPUT_DEGREES)
    const neutral = speedAfterPitchInput(0)
    const quarterTail = speedAfterPitchInput(MAX_PITCH_INPUT_DEGREES * 0.25)
    const fullTail = speedAfterPitchInput(MAX_PITCH_INPUT_DEGREES)

    expect(quarterNose).toBeGreaterThan(neutral)
    expect(halfNose).toBeGreaterThan(quarterNose)
    expect(fullNose).toBeGreaterThan(halfNose)
    expect(quarterTail).toBeLessThan(neutral)
    expect(fullTail).toBeLessThan(quarterTail)
    expect(fullNose - fullTail).toBeGreaterThan(0.5)
  })

  test('aggressive PID produces stronger physical braking for the same Pitch Input', () => {
    const physics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const neutralTilts = {
      ...baseFields,
      torquetilt_strength: 0,
      torquetilt_strength_regen: 0,
      braketilt_strength: 0,
      atr_strength_up: 0,
      atr_strength_down: 0,
      tiltback_constant: 0,
      tiltback_variable: 0,
      tiltback_variable_max: 0,
    }
    const input = {
      pitchInputDegrees: 0.4,
      pitchInputActive: true,
      speedKmh: 40,
      advancedPhysics: physics,
    }
    const soft = stepTunePreview(
      createTunePreviewState(40),
      readyParameters({ ...neutralTilts, kp: 10 }),
      input,
      0.5,
    )
    const aggressive = stepTunePreview(
      createTunePreviewState(40),
      readyParameters({ ...neutralTilts, kp: 30 }),
      input,
      0.5,
    )

    expect(aggressive.syntheticSpeedKmh).toBeLessThan(soft.syntheticSpeedKmh)
    expect(Math.abs(aggressive.angleDegrees - aggressive.targetAngleDegrees)).toBeLessThan(
      Math.abs(soft.angleDegrees - soft.targetAngleDegrees),
    )
  })

  test('physical preview dissipates released Pitch Input across the basic tune range', () => {
    const physics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const tunes = [
      { kp: 15, kp2: 0.4, ki: 0.015 },
      { kp: 20, kp2: 0.6, ki: 0.02 },
      { kp: 30, kp2: 1.1, ki: 0.03 },
    ]

    for (const tune of tunes) {
      const parameters = readyParameters({ ...baseFields, ...tune })
      let state = stepTunePreview(
        createTunePreviewState(20),
        parameters,
        {
          pitchInputDegrees: 5,
          pitchInputActive: true,
          speedKmh: 20,
          advancedPhysics: physics,
        },
        0.1,
      )
      let maximumReleasedAngle = 0
      for (let frame = 0; frame < 3600; frame += 1) {
        state = stepTunePreview(
          state,
          parameters,
          {
            pitchInputDegrees: 0,
            pitchInputActive: false,
            speedKmh: 20,
            advancedPhysics: physics,
          },
          1 / 60,
        )
        maximumReleasedAngle = Math.max(maximumReleasedAngle, Math.abs(state.angleDegrees))
      }

      expect(maximumReleasedAngle).toBeLessThan(10)
      expect(Number.isFinite(state.angularRateDegreesPerSecond)).toBe(true)
    }
  })

  test('applies acceleration Torque Tilt above current threshold and clamps its angle', () => {
    const parameters = readyParameters({ ...baseFields, torquetilt_angle_limit: 2 })
    const input = { pitchInputDegrees: 0, speedKmh: 15 }
    const below = calculateLongitudinalTarget(createTunePreviewState(), parameters, input, 1, 10)
    const above = calculateLongitudinalTarget(createTunePreviewState(), parameters, input, 1, 60)
    expect(below.torqueTiltDegrees).toBe(0)
    expect(above.torqueTiltDegrees).toBe(2)
  })

  test('braking current combines negative regen Torque Tilt with positive Brake Tilt', () => {
    const target = calculateLongitudinalTarget(
      { ...createTunePreviewState(), angleDegrees: 3 },
      readyParameters(),
      { pitchInputDegrees: 0, speedKmh: 15 },
      1,
      -60,
    )
    expect(target.torqueTiltDegrees).toBeLessThan(0)
    expect(target.brakeTiltDegrees).toBeGreaterThan(0)
  })

  test('Brake Tilt starts only above the bundled 2000 ERPM boundary', () => {
    const parameters = readyParameters()
    const state = createTunePreviewState()
    const below = calculateLongitudinalTarget(
      { ...state, angleDegrees: 3 },
      parameters,
      { pitchInputDegrees: 0, speedKmh: 7 },
      1,
      -60,
    )
    const above = calculateLongitudinalTarget(
      { ...state, angleDegrees: 3 },
      parameters,
      { pitchInputDegrees: 0, speedKmh: 7.1 },
      1,
      -60,
    )
    expect(below.brakeTiltDegrees).toBe(0)
    expect(above.brakeTiltDegrees).toBeGreaterThan(0)
  })

  test('constant and variable Tiltback respect start ERPM and maximum target', () => {
    const parameters = readyParameters()
    const state = createTunePreviewState()
    const stopped = calculateLongitudinalTarget(
      state,
      parameters,
      { pitchInputDegrees: 0, speedKmh: 0 },
      1,
      0,
    )
    const fast = calculateLongitudinalTarget(
      state,
      parameters,
      { pitchInputDegrees: 0, speedKmh: 40 },
      1,
      0,
    )
    expect(stopped.constantTiltbackDegrees).toBe(0)
    expect(stopped.variableTiltbackDegrees).toBe(0)
    expect(fast.constantTiltbackDegrees).toBe(1)
    expect(fast.variableTiltbackDegrees).toBe(3)
  })

  test('reports missing model fields instead of inventing defaults', () => {
    const model = createTunePreviewModel({ kp: 20 })
    expect(model.status).toBe('unsupported')
    if (model.status === 'unsupported') {
      expect(model.missingFields).toContain('torquetilt_strength')
      expect(model.missingFields).toContain('tiltback_variable_max')
    }
  })

  test('supports profiles saved before Tiltback ERPM thresholds were allowlisted', () => {
    const { tiltback_constant_erpm, tiltback_variable_erpm, ...legacyFields } = baseFields
    void tiltback_constant_erpm
    void tiltback_variable_erpm
    const model = createTunePreviewModel(legacyFields)
    expect(model.status).toBe('ready')
    if (model.status === 'ready') {
      expect(model.assumedFields).toEqual(['tiltback_constant_erpm', 'tiltback_variable_erpm'])
    }
  })

  test('maps the documented reference wheel speed to ERPM', () => {
    expect(speedKmhToReferenceErpm(3.5)).toBeCloseTo(1000)
    expect(speedKmhToReferenceErpm(-3.5)).toBeCloseTo(-1000)
    expect(speedKmhToReferenceErpm(50)).toBeCloseTo(50_000 / 3.5)
    expect(speedKmhToReferenceErpm(60)).toBeCloseTo(50_000 / 3.5)
  })

  test('derives ERPM from setup wheel diameter and motor pole count', () => {
    const defaults = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    expect(speedKmhToErpm(3.5, defaults)).toBeCloseTo(1000)
    expect(speedKmhToErpm(3.5, { ...defaults, motorPoleCount: 60 })).toBeCloseTo(2000)
    expect(speedKmhToErpm(3.5, { ...defaults, wheelDiameterInches: 8 })).toBeGreaterThan(1000)
  })

  test('fills missing setup-dependent physics values from documented defaults', () => {
    expect(resolveTunePreviewPhysics({ motorPresetId: 'superflux-ht', totalMassKg: 100 })).toEqual({
      ...DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
      motorPresetId: 'superflux-ht',
      totalMassKg: 100,
      motorTorqueNmPerAmp: TUNE_PREVIEW_MOTOR_PRESETS['superflux-ht'].motorTorqueNmPerAmp,
    })
  })

  test('moves ground right for forward travel when the Board nose points left', () => {
    expect(groundTravelToVisualOffset(0.1)).toBeGreaterThan(0)
    expect(groundTravelToVisualOffset(1)).toBeCloseTo(0)
  })

  test('terrain remains deterministic, bounded, and phase-sensitive', () => {
    const input = { hillsEnabled: true, hillHeightMeters: 1, hillSpacingMeters: 4 }
    expect(calculateTerrainSlope(0, input)).toBeLessThan(0)
    expect(calculateTerrainSlope(2, input)).toBeGreaterThan(0)
    expect(calculateTerrainSlope(0, input)).toBe(calculateTerrainSlope(0, input))
    expect(calculateTerrainSlope(0, { ...input, hillHeightMeters: 60 })).toBeCloseTo(
      calculateTerrainSlope(0, { ...input, hillHeightMeters: 50 }),
    )
  })

  test('terrain slope sign matches the visible terrain immediately ahead of the left-side Nose', () => {
    const input = { hillsEnabled: true, hillHeightMeters: 1, hillSpacingMeters: 4 }
    const visibleHeightAhead = terrainHeightRelativeToWheel(-6, 0, 1, 4)
    const atrTerrainSlope = calculateTerrainSlope(0, input)

    expect(Math.sign(atrTerrainSlope)).toBe(Math.sign(visibleHeightAhead))
  })

  test('terrain phase advances one 50 m cycle after five seconds at 36 km/h', () => {
    const parameters = readyParameters({
      ...baseFields,
      torquetilt_strength: 0,
      torquetilt_strength_regen: 0,
      braketilt_strength: 0,
      atr_strength_up: 0,
      atr_strength_down: 0,
      tiltback_constant: 0,
      tiltback_variable: 0,
      tiltback_variable_max: 0,
    })
    const input = {
      pitchInputDegrees: 0,
      speedKmh: 36,
      hillsEnabled: true,
      hillHeightMeters: 2,
      hillSpacingMeters: 50,
    }
    let state = createTunePreviewState(36)
    for (let step = 0; step < 20; step += 1) {
      state = stepTunePreview(state, parameters, input, 0.25)
    }

    expect(state.groundTravelMeters).toBeCloseTo(50)
    expect(calculateTerrainSlope(state.groundTravelMeters, input)).toBeCloseTo(
      calculateTerrainSlope(0, input),
    )
  })

  test('terrain visual and acceleration helpers preserve their contracts', () => {
    expect(terrainHeightRelativeToWheel(0, 1.25, 1, 4)).toBe(0)
    expect(terrainHeightRelativeToWheel(60, 1.25, 1, 4)).not.toBe(0)
    expect(terrainSlopeToSyntheticAcceleration(60)).toBeGreaterThan(
      terrainSlopeToSyntheticAcceleration(4),
    )
  })

  test('calculates signed Ground-to-Board angle from terrain tangent', () => {
    expect(calculateGroundToBoardAngleDegrees(5, 0)).toBeCloseTo(5)
    expect(calculateGroundToBoardAngleDegrees(5, Math.tan((3 * Math.PI) / 180))).toBeCloseTo(2)
    expect(calculateGroundToBoardAngleDegrees(-2, Math.tan((3 * Math.PI) / 180))).toBeCloseTo(-5)
  })

  test('projects gravity onto a 10% terrain grade', () => {
    const grade = 0.1
    const expectedAcceleration = (9.80665 * grade) / Math.sqrt(1 + grade ** 2)

    expect(terrainSlopeToSyntheticAcceleration(grade)).toBeCloseTo(expectedAcceleration, 5)
    expect(terrainSlopeToSyntheticAcceleration(-grade)).toBeCloseTo(-expectedAcceleration, 5)
  })

  test('calculates hill-load current from rider, Board, wheel, motor, and efficiency', () => {
    const grade = 0.1
    const physics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const totalMassKg = 70 + 18
    const wheelRadiusMeters = (11 * 0.0254) / 2
    const motorTorqueNmPerAmp =
      TUNE_PREVIEW_MOTOR_PRESETS[physics.motorPresetId].motorTorqueNmPerAmp
    const expectedCurrent =
      (((totalMassKg * 9.80665 * grade) / Math.sqrt(1 + grade ** 2)) * wheelRadiusMeters) /
      (motorTorqueNmPerAmp * 0.85)

    expect(calculateTerrainLoadCurrentAmps(grade, physics)).toBeCloseTo(expectedCurrent, 5)
    expect(calculateTerrainLoadCurrentAmps(-grade, physics)).toBeCloseTo(-expectedCurrent, 5)
  })

  test('setup-dependent mass, wheel, motor, and efficiency change physical response', () => {
    const defaults = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const grade = 0.1
    const load = calculateTerrainLoadCurrentAmps(grade, defaults)
    const acceleration = calculatePreviewAcceleration(30, 0, defaults)

    expect(
      calculateTerrainLoadCurrentAmps(grade, { ...defaults, totalMassKg: 120 }),
    ).toBeGreaterThan(load)
    expect(
      calculateTerrainLoadCurrentAmps(grade, { ...defaults, wheelDiameterInches: 14 }),
    ).toBeGreaterThan(load)
    expect(
      calculateTerrainLoadCurrentAmps(grade, { ...defaults, motorTorqueNmPerAmp: 0.4 }),
    ).toBeGreaterThan(load)
    expect(
      calculateTerrainLoadCurrentAmps(grade, { ...defaults, drivetrainEfficiency: 0.6 }),
    ).toBeGreaterThan(load)
    expect(calculatePreviewAcceleration(30, 0, { ...defaults, totalMassKg: 120 })).toBeLessThan(
      acceleration,
    )
    expect(
      calculatePreviewAcceleration(30, 0, { ...defaults, maxMotorCurrentAmps: 20 }),
    ).toBeLessThan(acceleration)
  })

  test('always converts physical hill current through the Tune ATR ratio', () => {
    const grade = 0.1
    const ratio = 8
    const physics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const loadCurrent = calculateTerrainLoadCurrentAmps(grade, physics)

    expect(calculateTerrainAtrDisturbance(grade, ratio, physics)).toBeCloseTo(
      loadCurrent / ratio,
      5,
    )
    expect(calculateTerrainAtrDisturbance(grade, ratio)).toBeCloseTo(loadCurrent / ratio, 5)
  })

  test('advanced hill-load current reaches Torque Tilt and cancels grade acceleration', () => {
    const physics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS
    const hillSpacingMeters = 50
    const hillHeightMeters = (0.1 * hillSpacingMeters) / Math.PI
    const state = {
      ...createTunePreviewState(15),
      groundTravelMeters: hillSpacingMeters / 2,
    }
    const input = {
      pitchInputDegrees: 0,
      speedKmh: 15,
      hillsEnabled: true,
      hillHeightMeters,
      hillSpacingMeters,
      advancedPhysics: physics,
    }
    const slope = calculateTerrainSlope(state.groundTravelMeters, input)
    const hillLoadCurrent = calculateTerrainLoadCurrentAmps(slope, physics)
    const parameters = readyParameters()
    const initial = stepTunePreview(state, parameters, input, 1 / 832)
    const next = stepTunePreview(initial, parameters, input, 0.25)

    expect(slope).toBeCloseTo(0.1, 5)
    expect(initial.syntheticCurrentAmps).toBeCloseTo(hillLoadCurrent, 5)
    expect(next.torqueTiltDegrees).toBeGreaterThan(0)
    expect(calculatePreviewAcceleration(hillLoadCurrent, slope, physics)).toBeCloseTo(0, 5)
  })

  test('tracks the terrain-driven Target after Pitch Input is released', () => {
    const parameters = readyParameters()
    const input = {
      pitchInputDegrees: 0,
      pitchInputActive: false,
      speedKmh: 15,
      hillsEnabled: true,
      hillHeightMeters: 2.5,
      hillSpacingMeters: 30,
      advancedPhysics: DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
    }
    let state = createTunePreviewState(15)
    let releasedErrorTotal = 0
    let releasedSamples = 0

    for (let frame = 0; frame < 600; frame += 1) {
      state = stepTunePreview(
        state,
        parameters,
        frame < 30
          ? {
              ...input,
              pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
              pitchInputActive: true,
            }
          : input,
        1 / 60,
      )
      if (frame >= 120) {
        releasedErrorTotal += Math.abs(state.targetAngleDegrees - state.angleDegrees)
        releasedSamples += 1
      }
    }

    const meanReleasedError = releasedErrorTotal / releasedSamples
    expect(meanReleasedError).toBeLessThan(2)
  })

  test('settles on flat ground without saturating motor current', () => {
    const parameters = readyParameters()
    const input = {
      pitchInputDegrees: 0,
      pitchInputActive: false,
      speedKmh: 15,
      hillsEnabled: false,
      advancedPhysics: DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
    }
    let state = createTunePreviewState(15)
    let minimumSpeed = Number.POSITIVE_INFINITY
    let maximumSpeed = Number.NEGATIVE_INFINITY
    let saturatedSamples = 0
    let maximumAbsoluteCurrent = 0

    for (let frame = 0; frame < 1800; frame += 1) {
      state = stepTunePreview(state, parameters, input, 1 / 60)
      if (frame < 1200) continue
      minimumSpeed = Math.min(minimumSpeed, state.syntheticSpeedKmh)
      maximumSpeed = Math.max(maximumSpeed, state.syntheticSpeedKmh)
      if (Math.abs(state.syntheticCurrentAmps) >= 59) saturatedSamples += 1
      maximumAbsoluteCurrent = Math.max(
        maximumAbsoluteCurrent,
        Math.abs(state.syntheticCurrentAmps),
      )
    }

    expect(maximumSpeed - minimumSpeed).toBeLessThan(1)
    expect(saturatedSamples).toBe(0)
    expect(maximumAbsoluteCurrent).toBeLessThan(20)
  })

  test('hill load can move Target through Torque Tilt while ATR remains disabled', () => {
    const parameters = readyParameters({
      ...baseFields,
      atr_strength_up: 0,
      atr_strength_down: 0,
      braketilt_strength: 0,
      tiltback_constant: 0,
      tiltback_variable: 0,
      tiltback_variable_max: 0,
    })
    const hillSpacingMeters = 30
    const state = {
      ...createTunePreviewState(15),
      groundTravelMeters: hillSpacingMeters / 2,
    }
    const next = stepTunePreview(
      state,
      parameters,
      {
        pitchInputDegrees: 0,
        speedKmh: 15,
        hillsEnabled: true,
        hillHeightMeters: 2.5,
        hillSpacingMeters,
        advancedPhysics: DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
      },
      0.25,
    )

    expect(next.atrDegrees).toBe(0)
    expect(next.torqueTiltDegrees).toBeGreaterThan(0)
    expect(next.targetAngleDegrees).toBeGreaterThan(0)
  })

  test('keeps ATR neutral on flat ground with zero controller current', () => {
    const parameters = readyParameters({
      ...baseFields,
      torquetilt_strength: 0,
      torquetilt_strength_regen: 0,
      braketilt_strength: 0,
      atr_threshold_up: 0,
      atr_threshold_down: 0,
      tiltback_constant: 0,
      tiltback_variable: 0,
      tiltback_variable_max: 0,
    })
    const state = stepTunePreview(
      createTunePreviewState(),
      parameters,
      { pitchInputDegrees: 0, speedKmh: 0, hillsEnabled: false },
      0.25,
    )

    expect(state.syntheticCurrentAmps).toBe(0)
    expect(state.atrAccelDiff).toBeCloseTo(0)
    expect(state.atrDegrees).toBeCloseTo(0)
  })

  test('zero and paused time do not advance response or ground', () => {
    const parameters = readyParameters()
    const state = createTunePreviewState()
    const input = { pitchInputDegrees: 10, pitchInputActive: true, speedKmh: 15 }
    expect(stepTunePreview(state, parameters, input, 0)).toBe(state)
    expect(stepTunePreview(state, parameters, { ...input, paused: true }, 1)).toBe(state)
  })

  test('dynamic speed remains finite and bounded in both directions', () => {
    const parameters = readyParameters()
    let upper = { ...createTunePreviewState(49.5), targetAngleDegrees: -35 }
    let lower = { ...createTunePreviewState(0.5), targetAngleDegrees: 35 }
    for (let index = 0; index < 20; index += 1) {
      upper = stepTunePreview(
        upper,
        parameters,
        {
          pitchInputDegrees: -12,
          pitchInputActive: true,
          speedKmh: 15,
        },
        0.25,
      )
      lower = stepTunePreview(
        lower,
        parameters,
        { pitchInputDegrees: 12, pitchInputActive: true, speedKmh: 15 },
        0.25,
      )
    }
    expect(upper.syntheticSpeedKmh).toBeGreaterThanOrEqual(-MAX_TUNE_PREVIEW_SPEED_KMH)
    expect(upper.syntheticSpeedKmh).toBeLessThanOrEqual(MAX_TUNE_PREVIEW_SPEED_KMH)
    expect(lower.syntheticSpeedKmh).toBeGreaterThanOrEqual(-MAX_TUNE_PREVIEW_SPEED_KMH)
    expect(lower.syntheticSpeedKmh).toBeLessThanOrEqual(MAX_TUNE_PREVIEW_SPEED_KMH)
    expect(
      Object.values(lower)
        .filter((value): value is number => typeof value === 'number')
        .every(Number.isFinite),
    ).toBe(true)
  })

  test('Pitch Input can carry speed through zero into reverse', () => {
    const tunes = [
      { kp: 15, kp2: 0.4, ki: 0.015 },
      { kp: 20, kp2: 0.6, ki: 0.02 },
      { kp: 30, kp2: 1.1, ki: 0.03 },
    ]

    for (const tune of tunes) {
      const parameters = readyParameters({ ...baseFields, ...tune })
      let state = createTunePreviewState(15)
      let crossingFrame: number | null = null
      for (let frame = 0; frame < 600; frame += 1) {
        state = stepTunePreview(
          state,
          parameters,
          {
            pitchInputDegrees: MAX_PITCH_INPUT_DEGREES,
            pitchInputActive: true,
            speedKmh: state.syntheticSpeedKmh,
          },
          1 / 60,
        )
        if (crossingFrame == null && state.syntheticSpeedKmh < 0) crossingFrame = frame
      }

      expect(crossingFrame).not.toBeNull()
      expect(crossingFrame!).toBeLessThan(120)
      expect(state.syntheticSpeedKmh).toBeLessThan(-1)
      expect(state.erpm).toBeLessThan(0)
      expect(state.groundTravelMeters).toBeLessThan(0)
    }
  })

  test('Brake Tilt recognizes braking current while traveling in reverse', () => {
    const target = calculateLongitudinalTarget(
      { ...createTunePreviewState(-15), angleDegrees: -3 },
      readyParameters(),
      { pitchInputDegrees: 0, speedKmh: -15 },
      1,
      60,
    )

    expect(target.brakeTiltDegrees).toBeLessThan(0)
  })

  test('reset restores speed without creating a false measured-acceleration impulse', () => {
    const state = {
      ...createTunePreviewState(25),
      angleDegrees: 4,
      groundTravelMeters: 12,
      measuredAccelerationErpmPerTick: 3,
    }
    expect(resetTunePreviewSpeed(state, 15)).toEqual({
      ...state,
      syntheticSpeedKmh: 15,
      erpm: speedKmhToReferenceErpm(15),
      measuredAccelerationErpmPerTick: 0,
    })
  })
})
