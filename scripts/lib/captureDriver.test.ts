import { expect, test } from 'bun:test'

import { CommandFailed, runOrDie } from './captureDriver.ts'

test('a stuck capture command is terminated and fails within its timeout', async () => {
  const started = Date.now()
  await expect(
    runOrDie([process.execPath, '-e', 'setInterval(() => {}, 1000)'], undefined, 100),
  ).rejects.toBeInstanceOf(CommandFailed)
  expect(Date.now() - started).toBeLessThan(3000)
})

test('cancelling a capture command unwinds instead of exiting its runner', async () => {
  const cancellation = new AbortController()
  const timer = setTimeout(() => cancellation.abort(), 100)
  try {
    await expect(
      runOrDie(
        [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        undefined,
        undefined,
        cancellation.signal,
      ),
    ).rejects.toBeInstanceOf(CommandFailed)
  } finally {
    clearTimeout(timer)
  }
})
