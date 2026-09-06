import type { TelemetryMinuteBucket, TelemetrySample } from 'vescape-core'

const BLOCK_DEFAULTS: TelemetryMinuteBucket = {
  id: 'b-0',
  startAtMs: 0,
  endAtMs: 60_000,
  bucketStartMs: 0,
  boardId: 'dev-a',
  boardName: 'Board A',
  sampleCount: 10,
  gpsPointCount: 5,
  preciseGpsPointCount: 4,
  maxAbsSpeedKmh: 20,
  maxGpsSpeedKmh: 18,
  avgSpeedKmh: 15,
  avgSpeedSampleCount: 10,
  minBatteryVoltage: 52,
  maxMotorCurrent: 10,
  maxBatteryCurrent: 8,
  maxDuty: 0.5,
  distanceDeltaM: 100,
  gpsDistanceM: 120,
  maxTempMosfet: null,
  maxTempMotor: null,
  firstLatitude: null,
  firstLongitude: null,
  firstMovingAtMs: 0,
  lastMovingAtMs: 60_000,
  boundaryBefore: 'none',
  boundaryMessage: null,
  gapBeforeMs: null,
  batteryUsedWh: 0,
  batteryRegenWh: 0,
}

export function makeBlock(overrides: Partial<TelemetryMinuteBucket> = {}): TelemetryMinuteBucket {
  const startAtMs = overrides.startAtMs ?? BLOCK_DEFAULTS.startAtMs
  const endAtMs = overrides.endAtMs ?? startAtMs + 60_000
  return {
    ...BLOCK_DEFAULTS,
    ...overrides,
    id: overrides.id ?? `b-${startAtMs}`,
    startAtMs,
    endAtMs,
    bucketStartMs: overrides.bucketStartMs ?? startAtMs,
    firstMovingAtMs: 'firstMovingAtMs' in overrides ? overrides.firstMovingAtMs! : startAtMs,
    lastMovingAtMs: 'lastMovingAtMs' in overrides ? overrides.lastMovingAtMs! : endAtMs,
  }
}

const SAMPLE_DEFAULTS: TelemetrySample = {
  id: 1,
  capturedAtMs: 0,
  boardId: 'dev-a',
  boardName: 'Board A',
  speedKmh: 0,
  batteryVoltage: 50,
  batteryPercent: null,
  motorCurrent: 0,
  batteryCurrent: 0,
  dutyCycle: 0,
  pitch: 0,
  roll: 0,
  balancePitch: 0,
  balanceCurrent: 0,
  erpm: 0,
  state: 0,
  switchState: 0,
  adc1: 0,
  adc2: 0,
  odometer: null,
  tempMosfet: null,
  tempMotor: null,
  latitude: null,
  longitude: null,
}

export function makeSample(overrides: Partial<TelemetrySample> = {}): TelemetrySample {
  return { ...SAMPLE_DEFAULTS, ...overrides }
}
