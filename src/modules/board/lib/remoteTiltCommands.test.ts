import { expect, test } from 'bun:test'
import { createTiltCommands } from './remoteTiltCommands'

const deferred = () => {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('slow bridge coalesces drag; release cannot be followed by obsolete held value', async () => {
  const first = deferred()
  const sent: number[] = []
  const enqueue = createTiltCommands(() => {})
  const initial = enqueue(() => {
    sent.push(140)
    return first.promise
  }, true)
  const stale = enqueue(async () => {
    sent.push(180)
    return true
  }, true)
  const latest = enqueue(async () => {
    sent.push(240)
    return true
  }, true)
  const release = enqueue(async () => {
    sent.push(128)
    return true
  })
  first.resolve(true)
  await Promise.all([initial, stale, latest, release])
  expect(sent).toEqual([140, 128])
})

test('rejected bridge call does not wedge subsequent cancel', async () => {
  const errors: unknown[] = []
  const enqueue = createTiltCommands((error) => errors.push(error))
  expect(
    await enqueue(async () => {
      throw new Error('bridge failure')
    }, true),
  ).toBe(false)
  expect(await enqueue(async () => true)).toBe(true)
  expect(errors).toHaveLength(1)
})

test('latest drag value reaches native before finger release', async () => {
  const first = deferred()
  const sent: number[] = []
  const enqueue = createTiltCommands(() => {})
  const initial = enqueue(() => {
    sent.push(140)
    return first.promise
  }, true)
  const stale = enqueue(async () => {
    sent.push(180)
    return true
  }, true)
  const latest = enqueue(async () => {
    sent.push(230)
    return true
  }, true)
  first.resolve(true)
  await Promise.all([initial, stale, latest])
  expect(sent).toEqual([140, 230])
})

test('disconnect discards queued intents before another board can connect', async () => {
  const first = deferred()
  const sent: number[] = []
  const enqueue = createTiltCommands(() => {})
  const initial = enqueue(() => first.promise, true)
  const queued = enqueue(async () => {
    sent.push(230)
    return true
  }, true)
  enqueue.clear()
  first.resolve(true)
  await Promise.all([initial, queued])
  expect(sent).toEqual([])
})
