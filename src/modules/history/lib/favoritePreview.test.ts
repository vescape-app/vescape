import { expect, test } from 'bun:test'
import type { HistoryGpsSample, TelemetrySample } from 'vescape-core'

import { summarizeFavoriteRange } from '@/modules/history/lib/favoritePreview'

function sample(overrides: Partial<TelemetrySample> & { capturedAtMs: number }): TelemetrySample {
  return {
    speedKmh: 0,
    batteryVoltage: 50,
    batteryCurrent: 0,
    dutyCycle: 0,
    tempMosfet: null,
    tempMotor: null,
    ...overrides,
  } as TelemetrySample
}

function gps(capturedAtMs: number, distanceFromPreviousM: number | null): HistoryGpsSample {
  return { capturedAtMs, distanceFromPreviousM } as HistoryGpsSample
}

test('summarizes only samples inside the range', () => {
  const samples = [
    sample({ capturedAtMs: 0, speedKmh: 5, dutyCycle: 0.1 }),
    sample({ capturedAtMs: 1_000, speedKmh: 20, dutyCycle: 0.5, tempMotor: 40 }),
    sample({ capturedAtMs: 2_000, speedKmh: 30, dutyCycle: 0.8, tempMotor: 55, tempMosfet: 60 }),
    sample({ capturedAtMs: 3_000, speedKmh: 99, dutyCycle: 0.95 }),
  ]

  const stats = summarizeFavoriteRange(samples, [], 1_000, 2_000)

  expect(stats.sampleCount).toBe(2)
  expect(stats.maxSpeedKmh).toBe(30)
  expect(stats.avgSpeedKmh).toBe(25)
  expect(stats.maxDuty).toBe(0.8)
  expect(stats.maxTempMotor).toBe(55)
  expect(stats.maxTempMosfet).toBe(60)
})

test('range bounds are order-independent', () => {
  const samples = [
    sample({ capturedAtMs: 1_000, speedKmh: 10 }),
    sample({ capturedAtMs: 2_000, speedKmh: 20 }),
  ]
  expect(summarizeFavoriteRange(samples, [], 2_000, 1_000)).toEqual(
    summarizeFavoriteRange(samples, [], 1_000, 2_000),
  )
})

test('speed uses magnitude so reverse riding still counts', () => {
  const samples = [
    sample({ capturedAtMs: 0, speedKmh: -40 }),
    sample({ capturedAtMs: 1_000, speedKmh: -20 }),
  ]
  const stats = summarizeFavoriteRange(samples, [], 0, 1_000)
  expect(stats.maxSpeedKmh).toBe(40)
  expect(stats.avgSpeedKmh).toBe(30)
})

test('integrates pack energy across time, splitting used and regen', () => {
  const samples = [
    // 1 h at +100 W → +100 Wh used.
    sample({ capturedAtMs: 0, batteryVoltage: 50, batteryCurrent: 2 }),
    sample({ capturedAtMs: 3_600_000, batteryVoltage: 50, batteryCurrent: 2 }),
  ]
  // Long gap must not integrate: cap at 5 s, so a single interval this long is skipped.
  const stats = summarizeFavoriteRange(samples, [], 0, 3_600_000)
  expect(stats.batteryUsedWh).toBe(0)
  expect(stats.batteryRegenWh).toBe(0)
})

test('integrates within the gap cap and separates regen', () => {
  const used = summarizeFavoriteRange(
    [
      sample({ capturedAtMs: 0, batteryVoltage: 50, batteryCurrent: 10 }),
      sample({ capturedAtMs: 1_000, batteryVoltage: 50, batteryCurrent: 10 }),
    ],
    [],
    0,
    1_000,
  )
  // 500 W over 1 s = 500 / 3600 Wh.
  expect(used.batteryUsedWh).toBeCloseTo(500 / 3600, 6)
  expect(used.batteryRegenWh).toBe(0)

  const regen = summarizeFavoriteRange(
    [
      sample({ capturedAtMs: 0, batteryVoltage: 50, batteryCurrent: -10 }),
      sample({ capturedAtMs: 1_000, batteryVoltage: 50, batteryCurrent: -10 }),
    ],
    [],
    0,
    1_000,
  )
  expect(regen.batteryRegenWh).toBeCloseTo(500 / 3600, 6)
  expect(regen.batteryUsedWh).toBe(0)
})

test('distance sums GPS deltas inside the range, null when absent', () => {
  const gpsSamples = [gps(500, null), gps(1_000, 10), gps(1_500, 25), gps(2_500, 99)]
  const samples = [sample({ capturedAtMs: 1_000 }), sample({ capturedAtMs: 2_000 })]
  const stats = summarizeFavoriteRange(samples, gpsSamples, 1_000, 2_000)
  // Only GPS at 1_500 falls in (1000, 2000]; the 1000 boundary is exclusive to avoid the
  // pre-range delta leaking in.
  expect(stats.distanceM).toBe(25)

  const noGps = summarizeFavoriteRange(samples, [], 1_000, 2_000)
  expect(noGps.distanceM).toBeNull()
})

test('empty range yields zeroed stats', () => {
  const samples = [sample({ capturedAtMs: 10_000 })]
  const stats = summarizeFavoriteRange(samples, [], 0, 1_000)
  expect(stats.sampleCount).toBe(0)
  expect(stats.distanceM).toBeNull()
  expect(stats.maxSpeedKmh).toBe(0)
})
