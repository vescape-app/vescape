import { expect, test } from 'bun:test'

import { rideDurationMs, rideMovingWindow } from '@/modules/history/lib/sessions'

test('Moving Window and Ride Time use native moving bounds', () => {
  const ride = { startAtMs: 1_000, endAtMs: 20_000, movingStartAtMs: 5_000, movingEndAtMs: 15_000 }

  expect(rideMovingWindow(ride)).toEqual({ startMs: 5_000, endMs: 15_000 })
  expect(rideDurationMs(ride)).toBe(10_000)
})

test('Ride Time falls back to wall-clock bounds for legacy data', () => {
  expect(
    rideDurationMs({
      startAtMs: 1_000,
      endAtMs: 20_000,
      movingStartAtMs: null,
      movingEndAtMs: null,
    }),
  ).toBe(19_000)
})
