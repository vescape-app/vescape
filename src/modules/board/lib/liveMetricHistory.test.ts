import { describe, expect, test } from 'bun:test'
import type { LocationEvent, TelemetryEvent } from 'vescape-core'

import {
  appendLocationSample,
  appendTelemetrySample,
  clearLiveMetricBuffer,
  clearLiveTelemetryBuffer,
  createLiveMetricBuffer,
  getLatestGps,
  getLatestTelemetry,
  getLatestApproximateGps,
  summarizeLiveStatus,
} from '@/modules/board/lib/liveMetricHistory'

function telemetry(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    generation: 1,
    pitch: 1,
    roll: 2,
    balancePitch: 3,
    balanceCurrent: 4,
    speed: 12,
    batteryVoltage: 48,
    batteryPercent: null,
    motorCurrent: 20,
    batteryCurrent: 7,
    erpm: 1000,
    dutyCycle: 0.42,
    state: 1,
    stateName: 'running',
    switchState: 0,
    adc1: 0.1,
    adc2: 0.2,
    odometer: 123,
    tempMosfet: 40,
    tempMotor: 35,
    avgLatency: 18,
    pullRateHz: 20,
    lastPacketAt: 10_000,
    ...overrides,
  }
}

function location(overrides: Partial<LocationEvent> = {}): LocationEvent {
  return {
    latitude: 50,
    longitude: 19,
    speedMps: 4,
    bearingDeg: 90,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: 3,
    altitudeM: 250,
    timestamp: 10_000,
    precise: true,
    ...overrides,
  }
}

describe('live metric history', () => {
  test('appends telemetry and prunes by live window', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 0, speed: 1 }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 5_000, speed: -8 }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 11_000, speed: 14 }), 10_000)

    expect(buffer.telemetry.map((s) => s.lastPacketAt)).toEqual([5_000, 11_000])
  })

  test('deduplicates telemetry samples by timestamp', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 1_000, speed: 1 }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 1_000, speed: 2 }), 10_000)

    expect(buffer.telemetry).toHaveLength(1)
    expect(buffer.telemetry[0].speed).toBe(1)
  })

  test('deduplicates location samples by timestamp', () => {
    const buffer = createLiveMetricBuffer()
    appendLocationSample(buffer, location({ timestamp: 1_000, speedMps: 1, accuracyM: 3 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 1_000, speedMps: 2, accuracyM: 12 }), 10_000)

    expect(buffer.locations).toHaveLength(1)
    expect(getLatestGps(buffer)).toMatchObject({ timestamp: 1_000, speedMps: 1, accuracyM: 3 })
    expect(summarizeLiveStatus(buffer)).toMatchObject({ gpsSampleCount: 1, gpsAccuracyM: 3 })
  })

  test('keeps approximate locations out of precise trail history', () => {
    const buffer = createLiveMetricBuffer()
    appendLocationSample(
      buffer,
      location({ timestamp: 1_000, precise: false, accuracyM: 80 }),
      10_000,
    )

    expect(buffer.locations).toEqual([])
    expect(getLatestGps(buffer)).toBe(null)
    expect(getLatestApproximateGps(buffer)).toMatchObject({
      timestamp: 1_000,
      precise: false,
      accuracyM: 80,
    })
    expect(summarizeLiveStatus(buffer)).toMatchObject({
      gpsSampleCount: 0,
      gpsLastFixAt: 1_000,
      gpsPrecise: false,
      gpsAccuracyM: 80,
    })
  })

  test('keeps telemetry sorted and prunes late samples against newest timestamp', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 11_000, speed: 11 }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 5_000, speed: 5 }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 0, speed: 1 }), 10_000)

    expect(buffer.telemetry.map((s) => s.lastPacketAt)).toEqual([5_000, 11_000])
  })

  test('keeps locations sorted and prunes late samples against newest timestamp', () => {
    const buffer = createLiveMetricBuffer()
    appendLocationSample(buffer, location({ timestamp: 11_000, speedMps: 11 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 5_000, speedMps: 5 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 0, speedMps: 1 }), 10_000)

    expect(buffer.locations.map((sample) => sample.timestamp)).toEqual([5_000, 11_000])
    expect(getLatestGps(buffer)?.speedMps).toBe(11)
  })

  test('stores raw telemetry values without transformation', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 1_000, speed: Number.NaN }), 10_000)
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 2_000, speed: -4 }), 10_000)

    expect(buffer.telemetry).toHaveLength(2)
    expect(buffer.telemetry[1].speed).toBe(-4)
  })

  test('applies native metric exclusion updates without changing raw telemetry', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 1_000, speed: 46 }), 10_000)
    appendTelemetrySample(
      buffer,
      telemetry({
        lastPacketAt: 2_000,
        speed: 4,
        metricExclusionUpdates: [
          { lastPacketAt: 1_000, metricExclusions: { max_speed: true, max_duty: true } },
        ],
      }),
      10_000,
    )

    expect(buffer.telemetry[0].speed).toBe(46)
    expect(buffer.telemetry[0].metricExclusions).toEqual({ max_speed: true, max_duty: true })
  })

  test('clears live metric buffers in place', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 2_000 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 3_000 }), 10_000)

    clearLiveMetricBuffer(buffer)

    expect(buffer).toEqual({ telemetry: [], locations: [], latestApproximateLocation: null })
    expect(summarizeLiveStatus(buffer)).toEqual({
      boardSampleCount: 0,
      boardLastPacketAt: null,
      boardAvgLatencyMs: null,
      gpsSampleCount: 0,
      gpsLastFixAt: null,
      gpsPrecise: false,
      gpsAccuracyM: null,
    })
  })

  test('clears board telemetry without dropping phone GPS state', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 2_000 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 3_000 }), 10_000)

    clearLiveTelemetryBuffer(buffer)

    expect(buffer.telemetry).toEqual([])
    expect(buffer.locations).toEqual([location({ timestamp: 3_000 })])
  })

  test('summarizes board and GPS freshness without exposing sample arrays', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 2_000, avgLatency: 25 }), 10_000)
    appendLocationSample(
      buffer,
      location({ timestamp: 3_000, precise: false, accuracyM: 12 }),
      10_000,
    )

    expect(summarizeLiveStatus(buffer)).toEqual({
      boardSampleCount: 1,
      boardLastPacketAt: 2_000,
      boardAvgLatencyMs: 25,
      gpsSampleCount: 0,
      gpsLastFixAt: 3_000,
      gpsPrecise: false,
      gpsAccuracyM: 12,
    })
  })

  test('returns latest telemetry and GPS samples for shared value seeding', () => {
    const buffer = createLiveMetricBuffer()
    appendTelemetrySample(buffer, telemetry({ lastPacketAt: 2_000, speed: 9 }), 10_000)
    appendLocationSample(buffer, location({ timestamp: 3_000, speedMps: 5 }), 10_000)

    expect(getLatestTelemetry(buffer)?.speed).toBe(9)
    expect(getLatestGps(buffer)?.speedMps).toBe(5)
  })
})
