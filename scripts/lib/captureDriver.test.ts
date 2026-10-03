import { expect, test } from 'bun:test'

import { CommandFailed, runOrDie } from './captureDriver.ts'

test('a stuck capture command is terminated and fails within its timeout', async () => {
  const started = Date.now()
  await expect(
    runOrDie([process.execPath, '-e', 'setInterval(() => {}, 1000)'], undefined, 100),
  ).rejects.toBeInstanceOf(CommandFailed)
  expect(Date.now() - started).toBeLessThan(3000)
})
