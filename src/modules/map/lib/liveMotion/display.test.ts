import { expect, test } from 'bun:test'
import type { MapDisplaySnapshot } from 'vescape-core'
import { MotionDisplay } from './display'
import { startPointAnimation } from './pointAnimation'

function renderer() {
  let local = 500
  let receive: ((snapshot: MapDisplaySnapshot) => void) | null = null
  let response: MapDisplaySnapshot = {
    id: 'live',
    source: 1,
    revision: 1,
    localClockMs: 100000,
    clockMs: 0,
    clockRate: 1,
    position: [0, 0],
    segments: [],
    pointHeading: 90,
    headingUntilMs: 2000,
    cameraHeading: 90,
    diagnostics: null,
    raw: null,
    trail: [],
  }
  const motion = new MotionDisplay(
    'live',
    {
      command: () => response,
      subscribe: (listener) => {
        receive = listener
        return {
          remove: () => {
            receive = null
          },
        }
      },
    },
    () => local,
  )
  const disconnect = motion.connect()
  motion.command({ op: 'options', active: true })
  return {
    motion,
    disconnect,
    at: (at: number) => {
      local = 500 + at
    },
    emit: (patch: Partial<MapDisplaySnapshot>) => {
      response = { ...response, ...patch }
      receive?.(response)
    },
  }
}

test('evaluates native velocity boundaries and holds after motion ends', () => {
  const { motion, emit } = renderer()
  emit({
    revision: 2,
    segments: [
      { startMs: 0, endMs: 400, from: [0, 0], to: [4, 0] },
      { startMs: 400, endMs: 1000, from: [4, 0], to: [7, 3] },
    ],
  })
  expect(motion.position(200)).toEqual([2, 0])
  expect(motion.position(700)).toEqual([5.5, 1.5])
  expect(motion.position(5000)).toEqual([7, 3])
  expect(motion.motionState(5000).moving).toBe(false)
  expect(motion.pointHeading(2000)).toBeNull()
  expect(motion.cameraHeading(5000)).toBe(90)
})

test('native clock calibration accounts for queued event delay and adapts replay rate', () => {
  const { motion, at, emit } = renderer()
  at(700)
  emit({ revision: 3, localClockMs: 100500, clockMs: 500, clockRate: 4 })
  // The event spent 200 ms queued; do not start its clock at receipt.
  expect(motion.now()).toBe(1300)
  expect(motion.duration(1000)).toBe(250)
  emit({ revision: 2, localClockMs: 100300, clockMs: 300, clockRate: 1 })
  expect(motion.now()).toBe(1300)
  at(800)
  emit({ revision: 4, localClockMs: 100800, clockMs: 1700, clockRate: 1 })
  expect(motion.now()).toBe(1700)
  at(900)
  expect(motion.now()).toBe(1800)
})

test('point adapter schedules segment boundaries, handles a future move, and cancels on teardown', () => {
  const { motion, emit, at, disconnect } = renderer()
  const calls: { coordinate: [number, number]; ms: number }[] = []
  let timer: (() => void) | null = null
  let active = true
  const stop = startPointAnimation({
    motion,
    now: motion.now,
    subscribe: motion.subscribe,
    isActive: () => active,
    moveTo: (coordinate, ms) => calls.push({ coordinate, ms }),
    schedule: (callback) => {
      timer = callback
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    cancel: () => {
      timer = null
    },
  })
  emit({
    revision: 2,
    segments: [
      { startMs: 0, endMs: 500, from: [0, 0], to: [0, 0] },
      { startMs: 500, endMs: 1000, from: [0, 0], to: [10, 0] },
    ],
  })
  expect(motion.motionState(0)).toEqual({ moving: false, wakeAfterMs: 500 })
  expect(calls.at(-1)).toEqual({ coordinate: [0, 0], ms: 500 })
  at(500)
  const boundary = timer as (() => void) | null
  boundary?.()
  expect(calls.at(-1)).toEqual({ coordinate: [10, 0], ms: 500 })
  at(1000)
  const terminal = timer as (() => void) | null
  terminal?.()
  expect(timer).toBeNull()
  expect(calls.at(-1)?.ms).toBe(0)
  active = false
  emit({ revision: 3 })
  expect(timer).toBeNull()
  stop()
  disconnect()
})
