import { expect, test } from 'bun:test'
import { LiveGpsMotion } from './motion'
import { startPointAnimation } from './pointAnimation'

test('native linear moves preserve braking and mid-segment retargets without frame transport', () => {
  let now = 0
  const revision = 1
  let active = true
  const motion = new LiveGpsMotion()
  motion.reset(revision, now)
  motion.accept({ longitude: 0, latitude: 0, timestamp: 0, accuracyM: 3 }, now, 0, revision)
  let changed: (() => void) | null = null
  let scheduled: (() => void) | null = null
  let from = 0
  let target = 0
  let started = 0
  let duration = 0
  let calls = 0
  const drawn = () =>
    from + (target - from) * (duration ? Math.min(1, (now - started) / duration) : 1)
  const stop = startPointAnimation({
    motion,
    now: () => now,
    isActive: () => active,
    moveTo: (coordinate, ms) => {
      from = drawn()
      target = coordinate[0] * 111320
      duration = ms
      started = now
      calls++
    },
    subscribe: (listener) => {
      changed = listener
      return () => {
        changed = null
      }
    },
    schedule: (callback) => {
      scheduled = callback
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    cancel: () => {
      scheduled = null
    },
  })
  const emit = () => {
    changed?.()
  }
  now = 1000
  motion.accept(
    { longitude: 10 / 111320, latitude: 0, timestamp: now, accuracyM: 3 },
    now,
    0,
    revision,
  )
  motion.updateSpeed(20 / 3.6, now, now, revision)
  emit()
  now = 1300
  const before = drawn()
  motion.updateSpeed(10 / 3.6, now, now, revision)
  emit()
  expect(drawn()).toBeCloseTo(before, 5)
  now = 1600
  motion.updateSpeed(0, now, now, revision)
  emit()
  const braking = drawn()
  expect(braking).toBeGreaterThan(before)
  now = 2000
  ;(scheduled as (() => void) | null)?.()
  const stopped = drawn()
  motion.accept(
    { longitude: 10.5 / 111320, latitude: 0, timestamp: now, accuracyM: 3 },
    now,
    0,
    revision,
  )
  emit()
  now = 2500
  expect(drawn()).toBeCloseTo(stopped, 4)
  expect(calls).toBeLessThan(12)
  active = false
  emit()
  expect(scheduled).toBeNull()
  const hiddenCalls = calls
  now = 5000
  expect(calls).toBe(hiddenCalls)
  active = true
  // Renderer resumes or reacquires within the same producer epoch.
  motion.reset(revision, now)
  motion.accept(
    { longitude: 50 / 111320, latitude: 0, timestamp: 0, accuracyM: 3 },
    now,
    0,
    revision,
  )
  emit()
  expect(drawn()).toBeCloseTo(50, 4)
  stop()
  expect(changed).toBeNull()
  expect(scheduled).toBeNull()
})
