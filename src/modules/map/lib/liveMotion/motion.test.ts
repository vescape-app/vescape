import { describe, expect, test } from 'bun:test'
import { LiveGpsMotion, type MotionFix } from './motion'
import { defaultMotionConfig } from './config'

const fix = (x: number, timestamp: number, y = 0, accuracyM = 3): MotionFix => ({
  longitude: x / 111320,
  latitude: y / 110574,
  timestamp,
  accuracyM,
})
const east = (m: LiveGpsMotion, t: number) => m.position(t)![0] * 111320
const north = (m: LiveGpsMotion, t: number) => m.position(t)![1] * 110574
function moving() {
  const m = new LiveGpsMotion()
  m.reset(1, 0)
  m.accept(fix(0, 0), 0, 0, 1)
  m.accept(fix(10, 1000), 1000, 0, 1)
  m.updateSpeed(20 / 3.6, 1000, 1000, 1)
  return m
}

describe('production display motion', () => {
  test('linear correction and prediction continue beyond correction, stop on expiry', () => {
    const m = moving()
    expect(east(m, 1250)).toBeCloseTo(3.19444, 4)
    expect(east(m, 1500) - east(m, 1250)).toBeCloseTo(east(m, 1250), 5)
    m.updateSpeed(20 / 3.6, 1900, 1900, 1)
    expect(east(m, 2250)).toBeGreaterThan(east(m, 2000))
    expect(east(m, 5000)).toBeCloseTo(east(m, 2500), 5)
  })
  test('20 → 10 → 0 changes future velocity, keeps correction deadline and continuity', () => {
    const m = moving()
    const before = east(m, 1300)
    m.updateSpeed(10 / 3.6, 1300, 1300, 1)
    expect(east(m, 1300)).toBeCloseTo(before, 6)
    expect(east(m, 1400) - before).toBeCloseTo((10 + (10 / 3.6) * 0.5) * 0.1, 5)
    const stopped = east(m, 1600)
    m.updateSpeed(0, 1600, 1600, 1)
    expect(east(m, 1600)).toBeCloseTo(stopped, 6)
    expect(m.segment(1600).durationMs).toBe(400)
    expect(east(m, 2000)).toBeCloseTo(stopped + 4, 5)
    expect(east(m, 2500)).toBeCloseTo(east(m, 2000), 5)
  })
  test('late behind fix brakes without bounce, lateral correction survives, persistent overshoot recovers', () => {
    const m = moving()
    m.updateSpeed(0, 1900, 1900, 1)
    const ahead = east(m, 2000)
    m.accept(fix(11, 2000, 1), 2000, 0, 1)
    expect(east(m, 2100)).toBeCloseTo(ahead, 5)
    expect(north(m, 2500)).toBeCloseTo(0.5, 5)
    for (let time = 3000; time <= 5000; time += 1000) m.accept(fix(11, time, 1), time, 0, 1)
    expect(m.diagnostics(5000).reason).toBe('persistent-overshoot-recovery')
    expect(east(m, 5500)).toBeLessThan(ahead)
    expect(east(m, 10000)).toBeCloseTo(11, 5)
  })
  test('real reversal follows GPS evidence, motor sign does not invent geography', () => {
    const m = moving()
    m.updateSpeed(-5, 1900, 1900, 1)
    m.accept(fix(20, 2000), 2000, 0, 1)
    m.accept(fix(10, 3000), 3000, 0, 1)
    m.updateSpeed(-5, 3000, 3000, 1)
    expect(m.pointHeading(3000)).toBeCloseTo(270, 3)
    expect(east(m, 3200)).toBeLessThan(east(m, 3000))
  })
  test('rejected/duplicate/out-of-order/delayed fixes never anchor cadence', () => {
    const m = moving()
    expect(m.accept(fix(12, 1500, 0, 100), 1500, 0, 1)).toBe(false)
    expect(m.accept(fix(10, 1000), 1600, 600, 1)).toBe(false)
    expect(m.accept(fix(20, 2000), 5000, 3000, 1)).toBe(false)
    m.accept(fix(20, 2000), 2000, 0, 1)
    expect(m.cadenceMs).toBe(1000)
  })
  test('clustered noise expires direction; accumulated slow movement and turns recover promptly', () => {
    const m = moving()
    for (let t = 2000; t <= 6000; t += 1000) m.accept(fix(10 + (t % 2000 ? 0.2 : -0.2), t), t, 0, 1)
    expect(m.pointHeading(6000)).toBeNull()
    expect(m.cameraHeading(6000)).not.toBe(0)
    m.accept(fix(11, 7000), 7000, 0, 1)
    m.accept(fix(12.5, 8000), 8000, 0, 1)
    expect(m.pointHeading(8000)).toBeCloseTo(90, 3)
    m.accept(fix(12.5, 9000, 5), 9000, 0, 1)
    expect(m.pointHeading(9000)).toBeCloseTo(0, 3)
    expect(m.cameraHeading(9000)).not.toBeNull()
    m.accept(fix(5, 10000, 5), 10000, 0, 1)
    expect(m.cameraHeading(10000)).toBeGreaterThanOrEqual(270)
    expect(m.cameraHeading(10000)).toBeLessThan(360)
  })
  test('unknown camera direction holds last heading; new source rejects old events and gaps discard direction', () => {
    const m = moving()
    expect(m.cameraHeading(1000)).toBeCloseTo(90, 3)
    expect(m.cameraHeading(5000)).toBeCloseTo(90, 3)
    m.reset(2, 6000)
    expect(m.accept(fix(20, 7000), 7000, 0, 1)).toBe(false)
    expect(m.updateSpeed(10, 7000, 7000, 1)).toBe(false)
    m.accept(fix(0, 0), 6000, 0, 2)
    m.accept(fix(100, 10000), 7000, 0, 2)
    expect(m.pointHeading(7000)).toBeNull()
  })
  test('configuration preserves position and correction timing; quality scales prediction', () => {
    const m = moving()
    const p = east(m, 1500)
    m.configure({ ...defaultMotionConfig, predictionStrength: 0 }, 1500)
    expect(east(m, 1500)).toBeCloseTo(p, 5)
    expect(m.segment(1500).durationMs).toBe(500)
    expect(m.diagnostics(1500).effectivePrediction).toBe(0)
    m.configure(defaultMotionConfig, 1500)
    m.accept(fix(30, 2000, 0, 20), 2000, 0, 1)
    m.updateSpeed(5, 2000, 2000, 1)
    expect(m.diagnostics(2000).effectivePrediction).toBeLessThan(0.5)
  })
})

test('unusable newer GPS disables prediction immediately without changing cadence anchor', () => {
  const m = moving()
  const before = east(m, 1200)
  expect(m.accept(fix(999, 1200, 0, 100), 1200, 0, 1)).toBe(false)
  expect(east(m, 1200)).toBeCloseTo(before, 5)
  expect(m.diagnostics(1200).effectivePrediction).toBe(0)
  expect(m.diagnostics(1200).reason).toBe('gps-unusable')
  m.accept(fix(20, 2000), 2000, 0, 1)
  expect(m.cadenceMs).toBe(1000)
})

test('prediction budget bounds large Board speed and never swallows later correction', () => {
  const m = moving()
  m.updateSpeed(100, 1001, 1001, 1)
  expect(east(m, 2000)).toBeCloseTo(18, 4)
  expect(east(m, 10000)).toBeCloseTo(18, 4)
})
