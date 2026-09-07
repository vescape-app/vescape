import { expect, mock, test } from 'bun:test'

import { createBoardLightsWriteQueue } from './boardLightsWriteQueue'

test('only an echo confirming the failed intent clears its error', async () => {
  const errors: (string | null)[] = []
  const writer = createBoardLightsWriteQueue(
    async () => {
      throw new Error('write failed')
    },
    (error) => errors.push(error),
  )
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  writer.write({ enabled: true })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(errors.at(-1)).toBe('Board lights could not be changed.')
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  expect(errors.at(-1)).toBe('Board lights could not be changed.')
  writer.setReportedState({ enabled: true, headlightsEnabled: false })
  expect(errors.at(-1)).toBeNull()
})

test('serializes complete light intents and keeps an older failure from replacing the latest result', async () => {
  let rejectFirst!: (error: Error) => void
  const send = mock(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject
      }),
  )
  const errors: (string | null)[] = []
  const writer = createBoardLightsWriteQueue(send, (error) => errors.push(error))
  writer.setReportedState({ enabled: false, headlightsEnabled: false })

  writer.write({ enabled: true })
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  writer.write({ headlightsEnabled: true })
  await Promise.resolve()

  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenNthCalledWith(1, true, false)

  send.mockImplementationOnce(async () => {})
  rejectFirst(new Error('first write failed'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(send).toHaveBeenNthCalledWith(2, true, true)
  expect(errors).toEqual([null, null])
})

test('a disconnect drops queued writes for the old board', async () => {
  let finishFirst!: () => void
  const send = mock(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve
      }),
  )
  const writer = createBoardLightsWriteQueue(send, () => {})
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  writer.write({ enabled: true })
  writer.write({ headlightsEnabled: true })
  await Promise.resolve()

  writer.setReportedState({ enabled: null, headlightsEnabled: null })
  finishFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(send).toHaveBeenCalledTimes(1)
})

test('dispose prevents queued sends and old failures from setting a new error', async () => {
  let rejectFirst!: (error: Error) => void
  const send = mock(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject
      }),
  )
  const errors: (string | null)[] = []
  const writer = createBoardLightsWriteQueue(send, (error) => errors.push(error))
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  writer.write({ enabled: true })
  writer.write({ headlightsEnabled: true })
  await Promise.resolve()

  writer.dispose()
  rejectFirst(new Error('old board failed'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(send).toHaveBeenCalledTimes(1)
  expect(errors).toEqual([null, null])
})

test('an old-board failure cannot set an error after a new board session starts', async () => {
  let rejectOld!: (error: Error) => void
  const send = mock(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectOld = reject
      }),
  )
  const errors: (string | null)[] = []
  const writer = createBoardLightsWriteQueue(send, (error) => errors.push(error))
  writer.setReportedState({ enabled: false, headlightsEnabled: false })
  writer.write({ enabled: true })
  await Promise.resolve()

  writer.setReportedState({ enabled: null, headlightsEnabled: null })
  writer.setReportedState({ enabled: true, headlightsEnabled: true })
  rejectOld(new Error('old board failed'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(errors).toEqual([null, null])
})
