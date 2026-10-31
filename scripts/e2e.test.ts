import { expect, test } from 'bun:test'
import { applicationId } from '../src/config/appVariant.ts'
import { waitForApp } from './phone-e2e.ts'

test('setup waits for the intended app, rather than a running Metro alone', async () => {
  let connected = false
  let polls = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      polls += 1
      return Response.json([{ appId: connected ? applicationId : 'another.app' }])
    },
  })
  try {
    let ready = false
    const waiting = waitForApp(server.port!, { exitCode: null }, new AbortController().signal).then(
      () => {
        ready = true
      },
    )
    await Bun.sleep(100)
    expect(polls).toBeGreaterThan(0)
    expect(ready).toBe(false)
    connected = true
    await waiting
    expect(ready).toBe(true)
  } finally {
    await server.stop(true)
  }
})

test('setup failure and cancellation stop waiting instead of starting tests', async () => {
  await expect(waitForApp(1, { exitCode: 1 }, new AbortController().signal)).rejects.toThrow(
    'setup exited',
  )
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  await expect(waitForApp(1, { exitCode: null }, abort.signal)).rejects.toThrow('cancelled')
})
