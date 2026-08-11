import { expect, test } from 'bun:test'
import type { RefloatConfigSnapshot } from 'vescape-core'

import { getTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibility'

const snapshot: RefloatConfigSnapshot = {
  capturedAt: 1000,
  boardId: 'board-1',
  canId: 1,
  schemaHash: 'schema',
  rawConfigHash: 'raw',
  rawConfigLength: 8,
  groups: [],
  missingFieldIds: [],
  fwVersion: 'FW 6.05',
  refloatVersion: 'Refloat future',
  refloatBaseVersion: null,
}

test('explains an unsupported reported Refloat version', () => {
  expect(getTuneCompatibilityIssue(snapshot, null)).toEqual({
    reason: 'unsupported-version',
    message:
      "Tune Profiles are unavailable because this app does not recognize the board's Refloat version: Refloat future. Update the app or retry after reconnecting the board.",
  })
})

test('explains a missing Refloat version', () => {
  expect(getTuneCompatibilityIssue({ ...snapshot, refloatVersion: null }, null)).toEqual({
    reason: 'missing-version',
    message:
      'Tune Profiles are unavailable because the board did not report a recognizable Refloat version. Retry after reconnecting the board.',
  })
})

test('accepts an available Tune compatibility version', () => {
  expect(getTuneCompatibilityIssue(snapshot, '1.1')).toBeNull()
})
