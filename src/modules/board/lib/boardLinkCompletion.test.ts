import { expect, test } from 'bun:test'

import {
  completeBoardLink,
  type BoardLinkCompletionPort,
} from '@/modules/board/lib/boardLinkCompletion'

interface Recorder {
  port: BoardLinkCompletionPort
  steps: string[]
}

function recorder(
  overrides: Partial<BoardLinkCompletionPort> = {},
  persistDelayTicks = 0,
): Recorder {
  const steps: string[] = []
  const port: BoardLinkCompletionPort = {
    async persist() {
      steps.push('persist:start')
      for (let i = 0; i < persistDelayTicks; i++) await Promise.resolve()
      steps.push('persist:done')
    },
    select() {
      steps.push('select')
    },
    async connect() {
      steps.push('connect')
    },
    dismiss() {
      steps.push('dismiss')
    },
    ...overrides,
  }
  return { port, steps }
}

test('native connect is issued only after persistence finished', async () => {
  // The regression: the old flow fired native `upsertBoard` and connected in the same tick, so
  // native could read a Board Link that had not landed yet.
  const { port, steps } = recorder({}, 5)

  await completeBoardLink(port, { hasLink: true })

  expect(steps).toEqual(['persist:start', 'persist:done', 'select', 'connect', 'dismiss'])
  expect(steps.indexOf('persist:done')).toBeLessThan(steps.indexOf('connect'))
})

test('an offline Board saves and is selected without attempting a connection', async () => {
  const { port, steps } = recorder()

  expect(await completeBoardLink(port, { hasLink: false })).toBe(true)

  expect(steps).toEqual(['persist:start', 'persist:done', 'select', 'dismiss'])
})

test('a failed connection keeps the saved Board and still dismisses setup', async () => {
  const { port, steps } = recorder({
    async connect() {
      steps.push('connect')
      throw new Error('board out of range')
    },
  })

  expect(await completeBoardLink(port, { hasLink: true })).toBe(true)
  await Promise.resolve()

  expect(steps).toEqual(['persist:start', 'persist:done', 'select', 'connect', 'dismiss'])
})

test('failed persistence selects nothing, connects nothing, and leaves setup open', async () => {
  const { port, steps } = recorder({
    async persist() {
      steps.push('persist:start')
      throw new Error('database locked')
    },
  })

  expect(await completeBoardLink(port, { hasLink: true })).toBe(false)

  expect(steps).toEqual(['persist:start'])
})
