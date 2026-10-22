import { expect, test } from 'bun:test'

import { alertZoneSweep, getAlertThresholdValues } from '@/modules/alerts/lib/alertTest'

test('chart thresholds include range ceilings once in numeric order', () => {
  expect(
    getAlertThresholdValues([
      {
        id: 'range',
        controlId: 'duty',
        threshold: 80,
        thresholdMax: 90,
        spec: 'preset:tick',
        repeatEverySeconds: null,
      },
      {
        id: 'single',
        controlId: 'duty',
        threshold: 90,
        thresholdMax: null,
        spec: 'preset:beep',
        repeatEverySeconds: null,
      },
    ]),
  ).toEqual([80, 90])
})

const rule = (threshold: number, thresholdMax: number | null = null) => ({
  id: `r${threshold}`,
  controlId: 'motor-temp',
  threshold,
  thresholdMax,
  spec: 'preset(1)',
  repeatEverySeconds: null,
})

/** Time into the sweep when it first reaches [share] of its travel. */
function timeAt(sweep: ReturnType<typeof alertZoneSweep>, share: number) {
  let low = 0
  let high = 1
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (sweep.easing(mid) < share) low = mid
    else high = mid
  }
  return low * sweep.durationMs
}

test('zone sweep crosses empty range fast and lingers around thresholds', () => {
  const sweep = alertZoneSweep([rule(75), rule(85)], 0, 100, true)
  expect(sweep.easing(0)).toBe(0)
  expect(sweep.easing(1)).toBe(1)
  expect(timeAt(sweep, 0.72)).toBeLessThan(2_000)
  expect(timeAt(sweep, 0.8) - timeAt(sweep, 0.72)).toBeGreaterThan(4_000)
  expect(timeAt(sweep, 0.9) - timeAt(sweep, 0.82)).toBeGreaterThan(4_000)
  // The tail past the last threshold leaves time for a repeat.
  expect(sweep.durationMs - timeAt(sweep, 0.9)).toBeGreaterThan(10_000)
})

test('downward sweep lingers at battery thresholds measured from full', () => {
  const sweep = alertZoneSweep([rule(20)], 0, 100, false)
  // 100 → 23 % is empty, 23 → 15 % is the zone.
  expect(timeAt(sweep, 0.77)).toBeLessThan(2_500)
  expect(timeAt(sweep, 0.85) - timeAt(sweep, 0.77)).toBeGreaterThan(4_000)
})

test('Geiger range stays slow across its whole span', () => {
  const sweep = alertZoneSweep([rule(80, 95)], 0, 100, true)
  expect(timeAt(sweep, 0.95) - timeAt(sweep, 0.8)).toBeGreaterThan(6_000)
})
