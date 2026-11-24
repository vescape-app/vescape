import { expect, test } from 'bun:test'
import type { BoardConfigValues } from 'vescape-core'

import { getTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibility'

const boardConfig: BoardConfigValues = {
  boardId: 'board-1',
  refloatBaseVersion: null,
  capturedAtMs: 1000,
  freshness: 'fresh',
  values: {},
  schemaHash: 'schema',
}

test('explains an unsupported reported Refloat version', () => {
  expect(getTuneCompatibilityIssue(boardConfig, null, 'Refloat future')).toEqual({
    reason: 'unsupported-version',
    message:
      "Tune Profiles are unavailable because this app does not recognize the board's Refloat version: Refloat future. Update the app or retry after reconnecting the board.",
  })
})

test('explains a missing Refloat version', () => {
  expect(getTuneCompatibilityIssue(boardConfig, null, null)).toEqual({
    reason: 'missing-version',
    message:
      'Tune Profiles are unavailable because the board did not report a recognizable Refloat version. Retry after reconnecting the board.',
  })
})

test('accepts an available Tune compatibility version', () => {
  expect(getTuneCompatibilityIssue(boardConfig, '1.1', 'Refloat 1.1')).toBeNull()
})
