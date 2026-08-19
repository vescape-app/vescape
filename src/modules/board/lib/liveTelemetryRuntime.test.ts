import { describe, expect, test } from 'bun:test'
import type { LiveStateEvent, LocationEvent, TelemetryEvent } from 'vescape-core'

import { createLiveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

function telemetry(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    generation: 7,
    hasFault: false,
    faultCode: 0,
    pitch: 1,
    roll: 2,
    balancePitch: 3,
    balanceCurrent: 4,
    speed: -15,
    batteryVoltage: 48,
    batteryPercent: null,
    motorCurrent: 20,
    batteryCurrent: 7,
    erpm: 1000,
    dutyCycle: -0.5,
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

function liveState(samples: TelemetryEvent[]): LiveStateEvent {
  return {
    presence: {
      phase: 'idle',
      purpose: null,
      owner: 'none',
      startedAt: null,
      deadlineAt: null,
      observations: [],
      decision: null,
      reason: null,
    },
    board: {
      phase: 'connected',
      selectedBoardId: 'board-1',
      connectedBoardId: 'board-1',
      bleId: 'ble-1',
      name: 'Board',
      connectionSeq: 7,
      lastTelemetryAt: samples.at(-1)?.lastPacketAt ?? null,
      recentTelemetry: samples,
      error: null,
      autoConnect: true,
      linkIntegrity: 'trusted',
      remoteTilt: null,
    },
    gps: {
      phase: 'active',
      latestFix: null,
      recentLocations: [],
      error: null,
    },
    scan: {
      phase: 'idle',
      devices: [],
      error: null,
    },
    recording: {
      enabled: false,
      paused: false,
      activeBoardId: null,
      startedAt: null,
    },
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

describe('live telemetry runtime', () => {
  test('seeds hot values and history from native snapshot', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(
      liveState([
        telemetry({ lastPacketAt: 9_000, speed: 3 }),
        telemetry({ lastPacketAt: 10_000, speed: -8 }),
      ]),
    )

    expect(runtime.values.speedKmh.value).toBe(8)
    expect(runtime.values.dutyPercent.value).toBe(50)
    expect(runtime.values.pitch.value).toBe(1)
    expect(runtime.values.roll.value).toBe(2)
    expect(runtime.values.balancePitch.value).toBe(3)
    const telemetryBuf = runtime.getTelemetry()
    expect(telemetryBuf.map((t) => ({ ts: t.lastPacketAt, speed: Math.abs(t.speed!) }))).toEqual([
      { ts: 9_000, speed: 3 },
      { ts: 10_000, speed: 8 },
    ])
  })

  test('ignores stale generation frames on both paths', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))

    runtime.ingestTick(telemetry({ generation: 6, speed: 30 }))
    const accepted = runtime.ingestHistoryBatch([telemetry({ generation: 6, speed: 30 })])

    expect(accepted).toBe(null)
    expect(runtime.values.speedKmh.value).toBe(null)
    expect(runtime.getSnapshot().liveStatus.boardSampleCount).toBe(0)
  })

  test('tick updates hot values; history batch updates buffer and summary', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))

    runtime.ingestTick(
      telemetry({ speed: -22, dutyCycle: 0.25, pitch: 37.5, avgLatency: 11, pullRateHz: 28 }),
    )
    expect(runtime.values.speedKmh.value).toBe(22)
    expect(runtime.values.dutyPercent.value).toBe(25)
    expect(runtime.values.pitch.value).toBe(37.5)
    expect(runtime.values.avgLatencyMs.value).toBe(11)
    expect(runtime.values.pullRateHz.value).toBe(28)

    runtime.ingestTick(telemetry({ roll: -12.25, balancePitch: 4.5 }))
    expect(runtime.values.roll.value).toBe(-12.25)
    expect(runtime.values.balancePitch.value).toBe(4.5)

    runtime.ingestHistoryBatch([telemetry({ speed: -22, dutyCycle: 0.25, avgLatency: 11 })])
    expect(runtime.consumePendingSnapshot()?.liveStatus.boardAvgLatencyMs).toBe(11)
  })

  test('history batch orders out-of-order samples; hot values follow tick', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))

    runtime.ingestTick(telemetry({ lastPacketAt: 20_000, speed: -30, avgLatency: 9 }))
    const accepted = runtime.ingestHistoryBatch([
      telemetry({ lastPacketAt: 20_000, speed: -30, avgLatency: 9 }),
      telemetry({ lastPacketAt: 10_000, speed: -5, avgLatency: 40 }),
    ])

    expect(runtime.values.speedKmh.value).toBe(30)
    expect(runtime.values.avgLatencyMs.value).toBe(9)
    expect(accepted).toBe(10_000)
    const snapshot = runtime.consumePendingSnapshot()
    expect(snapshot?.liveStatus.boardLastPacketAt).toBe(20_000)
    const speeds = runtime
      .getTelemetry()
      .map((t) => ({ ts: t.lastPacketAt, speed: Math.abs(t.speed!) }))
    expect(speeds).toEqual([
      { ts: 10_000, speed: 5 },
      { ts: 20_000, speed: 30 },
    ])
  })

  test('ingests locations into location history and status', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })

    runtime.ingestLocation(location({ timestamp: 12_000, accuracyM: 5 }))
    const snapshot = runtime.consumePendingSnapshot()

    expect(snapshot?.liveLocationHistory).toEqual([location({ timestamp: 12_000, accuracyM: 5 })])
    expect(snapshot?.latestApproximateLocation).toEqual(
      location({ timestamp: 12_000, accuracyM: 5 }),
    )
    expect(snapshot?.liveStatus).toMatchObject({
      gpsSampleCount: 1,
      gpsLastFixAt: 12_000,
      gpsPrecise: true,
      gpsAccuracyM: 5,
    })
  })

  test('keeps approximate locations out of live trail history', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })

    runtime.ingestLocation(location({ timestamp: 12_000, precise: false, accuracyM: 100 }))
    const snapshot = runtime.consumePendingSnapshot()

    expect(snapshot?.liveLocationHistory).toEqual([])
    expect(snapshot?.latestApproximateLocation).toEqual(
      location({ timestamp: 12_000, precise: false, accuracyM: 100 }),
    )
    expect(snapshot?.liveStatus).toMatchObject({
      gpsSampleCount: 0,
      gpsLastFixAt: 12_000,
      gpsPrecise: false,
      gpsAccuracyM: 100,
    })
  })

  test('coalesces a history batch into a single pending publish', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))

    runtime.ingestTick(telemetry({ lastPacketAt: 1_050, speed: 2 }))
    runtime.ingestHistoryBatch([
      telemetry({ lastPacketAt: 1_000, speed: 1 }),
      telemetry({ lastPacketAt: 1_050, speed: 2 }),
    ])

    expect(runtime.values.speedKmh.value).toBe(2)
    runtime.consumePendingSnapshot()
    const speeds = runtime
      .getTelemetry()
      .map((t) => ({ ts: t.lastPacketAt, speed: Math.abs(t.speed!) }))
    expect(speeds).toEqual([
      { ts: 1_000, speed: 1 },
      { ts: 1_050, speed: 2 },
    ])
    expect(runtime.consumePendingSnapshot()).toBe(null)
  })

  test('keeps hot values raw when native sanitizer corrects older live metric extrema', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))

    runtime.ingestHistoryBatch([telemetry({ lastPacketAt: 1_000, speed: 46 })])
    runtime.ingestTick(telemetry({ lastPacketAt: 2_000, speed: 4 }))
    runtime.ingestHistoryBatch([
      telemetry({
        lastPacketAt: 2_000,
        speed: 4,
        metricExclusionUpdates: [
          { lastPacketAt: 1_000, metricExclusions: { max_speed: true, max_duty: true } },
        ],
      }),
    ])

    expect(runtime.values.speedKmh.value).toBe(4)
    expect(runtime.getTelemetry()[0].speed).toBe(46)
    expect(runtime.getTelemetry()[0].metricExclusions).toEqual({
      max_speed: true,
      max_duty: true,
    })
  })

  test('reset clears hot values and snapshot', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([]))
    runtime.ingestTick(telemetry({ speed: -22, dutyCycle: 0.25, avgLatency: 11 }))
    runtime.ingestHistoryBatch([telemetry({ speed: -22, dutyCycle: 0.25, avgLatency: 11 })])
    runtime.ingestLocation(location({ timestamp: 12_000 }))

    const snapshot = runtime.reset()

    expect(runtime.values.speedKmh.value).toBe(null)
    expect(runtime.values.dutyPercent.value).toBe(null)
    expect(runtime.values.pitch.value).toBe(null)
    expect(runtime.values.avgLatencyMs.value).toBe(null)
    expect(snapshot.liveLocationHistory).toEqual([])
    expect(snapshot.latestApproximateLocation).toBe(null)
    expect(runtime.getTelemetry()).toEqual([])
    expect(snapshot.liveStatus).toEqual({
      boardSampleCount: 0,
      boardLastPacketAt: null,
      boardAvgLatencyMs: null,
      gpsSampleCount: 0,
      gpsLastFixAt: null,
      gpsPrecise: false,
      gpsAccuracyM: null,
    })
  })

  test('clears board telemetry while retaining phone GPS state', () => {
    const runtime = createLiveTelemetryRuntime({ windowMs: () => 60_000 })
    runtime.seedFromLiveState(liveState([telemetry({ speed: 22 })]))
    runtime.ingestLocation(location({ timestamp: 12_000 }))
    runtime.consumePendingSnapshot()

    const snapshot = runtime.clearBoardTelemetry()

    expect(runtime.values.speedKmh.value).toBe(null)
    expect(runtime.values.motorCurrent.value).toBe(null)
    expect(runtime.getTelemetry()).toEqual([])
    expect(snapshot.liveLocationHistory).toEqual([location({ timestamp: 12_000 })])
    expect(snapshot.liveStatus.boardSampleCount).toBe(0)
    expect(snapshot.liveStatus.gpsSampleCount).toBe(1)
  })
})
