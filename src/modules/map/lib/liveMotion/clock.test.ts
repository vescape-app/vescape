import { expect, test } from 'bun:test'
import { DisplayClock } from './clock'
import { LiveGpsMotion } from './motion'

test('resume snapshot keeps queued GPS and speed stale and ignores their old replay rate', () => {
  const clock = new DisplayClock(),
    motion = new LiveGpsMotion()
  clock.observeSource(10000, 1, 500, true)
  motion.reset(1, clock.now(500))
  expect(clock.observeSource(1000, 4, 550)).toBe(false)
  expect(clock.age(1000, 550)).toBe(9050)
  expect(clock.duration(1000)).toBe(1000)
  expect(
    motion.accept(
      { longitude: 0, latitude: 0, timestamp: 1000, accuracyM: 3 },
      clock.now(550),
      clock.age(1000, 550),
      1,
    ),
  ).toBe(false)
  expect(clock.observeSource(10100, 4, 600)).toBe(true)
  expect(clock.age(10100, 650)).toBe(200)
  // A new producer may restart its clock; it must explicitly reset the boundary.
  expect(clock.observeSource(0, 1, 700, true)).toBe(true)
  expect(clock.age(0, 710)).toBe(10)
})

test('replay rate adapts cadence at the renderer boundary without changing measurements', () => {
  const clock = new DisplayClock(),
    motion = new LiveGpsMotion()
  clock.configure(4, 0)
  motion.reset(1, clock.now(0))
  motion.accept({ longitude: 0, latitude: 0, timestamp: 100000, accuracyM: 3 }, clock.now(0), 0, 1)
  const measured = { longitude: 10 / 111320, latitude: 0, timestamp: 101000, accuracyM: 3 }
  motion.accept(measured, clock.now(250), 0, 1)
  expect(clock.duration(motion.segment(clock.now(250)).durationMs)).toBe(250)
  expect(motion.position(clock.now(375))![0] * 111320).toBeCloseTo(5, 4)
  const before = motion.position(clock.now(375))
  clock.configure(1, 375)
  expect(motion.position(clock.now(375))).toEqual(before)
  expect(clock.duration(motion.segment(clock.now(375)).durationMs)).toBe(500)
  expect(measured.timestamp).toBe(101000)
})
