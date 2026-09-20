import { expect, test } from 'bun:test'
import { stepDelta } from './numberStep'
import { speedFromKmh, speedInputToKmh } from './units'

test('untouched converted settings keep canonical precision across repeated unit switches', () => {
  for (const saved of [3, 12, 15, 40, 40.2336, 57.89123456789]) {
    let canonical = saved
    for (let i = 0; i < 100; i++) {
      for (const units of ['imperial', 'metric'] as const) {
        canonical = speedInputToKmh(speedFromKmh(canonical, units), canonical, units, 0, 120)
        expect(canonical).toBe(saved)
      }
    }
  }
})

test('speed editor steps convert actual edits and preserve exact physical endpoints', () => {
  const displayed = speedFromKmh(40, 'imperial')
  const edited = speedInputToKmh(displayed + stepDelta(displayed, 1), 40, 'imperial', 0, 120)
  expect(edited).toBeCloseTo(40.2336, 10)
  expect(speedInputToKmh(speedFromKmh(20, 'imperial'), 19, 'imperial', 0, 20)).toBe(20)
  expect(speedInputToKmh(speedFromKmh(1, 'imperial'), 2, 'imperial', 1, 60)).toBe(1)
  expect(speedInputToKmh(1000, 10, 'imperial', 1, 60)).toBe(60)
  expect(speedInputToKmh(-1000, 10, 'imperial', 1, 60)).toBe(1)
})
