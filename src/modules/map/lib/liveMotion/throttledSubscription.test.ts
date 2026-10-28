import { expect, test } from 'bun:test'
import { subscribeThrottled } from './throttledSubscription'

test('diagnostic trail subscriber coalesces high-rate motion publications to 4 Hz', () => {
  const listeners = new Set<() => void>()
  const times = new Map<number, () => void>()
  const delays: number[] = []
  const calls: number[] = []
  let now = 0
  let nextTimer = 0
  const unsubscribe = subscribeThrottled(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => calls.push(now),
    250,
    () => now,
    (callback, delay) => {
      const id = ++nextTimer
      times.set(id, callback)
      delays.push(delay)
      return id as unknown as ReturnType<typeof setTimeout>
    },
    (timer) => times.delete(timer as unknown as number),
  )
  const publish = () => listeners.forEach((listener) => listener())
  publish()
  now = 50
  publish()
  now = 100
  publish()
  expect(calls).toEqual([0])
  expect(times.size).toBe(1)
  now = 250
  const firstTimer = times.get(1)!
  times.delete(1)
  firstTimer()
  expect(calls).toEqual([0, 250])
  now = 260
  publish()
  expect(calls).toEqual([0, 250])
  expect(delays).toEqual([200, 240])
  unsubscribe()
  expect(listeners.size).toBe(0)
  expect(times.size).toBe(0)
})
