import { expect, test } from 'bun:test'
import { tuneProfileSummary } from './profileSummary'

test('summary follows Basic ranges and the stronger asymmetric ATR direction', () => {
  expect(
    tuneProfileSummary({
      kp: 24,
      turntilt_strength: 9,
      atr_strength_up: 0.2,
      atr_strength_down: 1.6,
    }),
  ).toEqual({ aggression: 3, turning: 3, atr: 4 })
})

test('missing or invalid config is unknown while explicit zero remains a real level', () => {
  expect(
    tuneProfileSummary({ kp: NaN, turntilt_strength: '9', atr_strength_up: Infinity }),
  ).toEqual({ aggression: null, turning: null, atr: null })
  expect(tuneProfileSummary({ kp: 15, turntilt_strength: 0, atr_strength_down: 0 })).toEqual({
    aggression: 0,
    turning: 0,
    atr: 0,
  })
})

test('custom values outside Basic ranges stay within the five segments', () => {
  expect(tuneProfileSummary({ kp: 100, turntilt_strength: -10, atr_strength_up: 20 })).toEqual({
    aggression: 5,
    turning: 0,
    atr: 5,
  })
})
