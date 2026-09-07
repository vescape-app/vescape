import { expect, mock, test } from 'bun:test'

import { createTuneModalOperationRunner } from './tuneModalOperationRunner'

test('starts only one modal mutation until the current operation settles', async () => {
  let finish!: () => void
  const operation = mock(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const pending: boolean[] = []
  const run = createTuneModalOperationRunner((value) => pending.push(value))

  run(operation)
  run(operation)
  expect(operation).toHaveBeenCalledTimes(1)
  expect(pending).toEqual([true])

  finish()
  await new Promise((resolve) => setTimeout(resolve, 0))
  run(operation)

  expect(operation).toHaveBeenCalledTimes(2)
  expect(pending).toEqual([true, false, true])
})
