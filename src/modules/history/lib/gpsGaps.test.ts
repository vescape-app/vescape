import { describe, expect, test } from 'bun:test'

import { toGpsGapRanges } from '@/modules/history/lib/gpsGaps'

const fixes = (...ms: number[]) => ms.map((capturedAtMs) => ({ capturedAtMs }))
/** A continuous recording: one board sample per second between the two moments. */
const recording = (startMs: number, endMs: number) => {
  const times: number[] = []
  for (let ms = startMs; ms <= endMs; ms += 1_000) times.push(ms)
  return times
}

describe('gps gaps', () => {
  test('marks a dropout between two fixes', () => {
    expect(toGpsGapRanges(fixes(0, 1_000, 31_000, 32_000), recording(0, 32_000), 10_000)).toEqual([
      { startMs: 1_000, endMs: 31_000 },
    ])
  })

  test('ignores gaps shorter than the threshold', () => {
    expect(toGpsGapRanges(fixes(0, 5_000, 10_000), recording(0, 10_000), 10_000)).toEqual([])
  })

  test('marks the recording before the first fix and after the last', () => {
    expect(toGpsGapRanges(fixes(20_000, 21_000), recording(0, 60_000), 10_000)).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 21_000, endMs: 60_000 },
    ])
  })

  test('marks a whole recording that never got a fix', () => {
    expect(toGpsGapRanges([], recording(0, 60_000), 10_000)).toEqual([
      { startMs: 0, endMs: 60_000 },
    ])
  })

  test('leaves a paused recording alone', () => {
    const paused = [...recording(0, 5_000), ...recording(600_000, 605_000)]
    expect(toGpsGapRanges(fixes(0, 5_000, 600_000, 605_000), paused, 10_000)).toEqual([])
  })

  test('marks a dropout inside one span without spilling into the pause', () => {
    const paused = [...recording(0, 60_000), ...recording(600_000, 605_000)]
    expect(toGpsGapRanges(fixes(0, 600_000, 605_000), paused, 10_000)).toEqual([
      { startMs: 0, endMs: 60_000 },
    ])
  })

  test('ignores fixes recorded outside any span', () => {
    expect(toGpsGapRanges(fixes(-50_000, 30_000, 90_000), recording(0, 60_000), 10_000)).toEqual([
      { startMs: 0, endMs: 30_000 },
      { startMs: 30_000, endMs: 60_000 },
    ])
  })

  test('returns nothing without a recording', () => {
    expect(toGpsGapRanges(fixes(0), [], 10_000)).toEqual([])
  })
})
