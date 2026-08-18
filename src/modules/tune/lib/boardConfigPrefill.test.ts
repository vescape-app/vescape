import { expect, test } from 'bun:test'
import type { BoardConfigValues } from 'vescape-core'

import { boardConfigPrefill } from '@/modules/tune/lib/boardConfigPrefill'

const cached: BoardConfigValues = {
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  capturedAtMs: 1000,
  freshness: 'provisional',
  values: { kp: 12, ki: 0.5, not_a_tune_field: 3 },
}

test('renders cached board values as tune groups', () => {
  const prefill = boardConfigPrefill(cached, 'board-1')

  expect(prefill?.refloatBaseVersion).toBe('1.3.0')
  const fields = prefill?.groups.flatMap((group) => group.fields) ?? []
  expect(fields.map((field) => field.id)).toEqual(['kp', 'ki'])
  expect(fields[0]).toMatchObject({ label: 'Angle P', value: 12, min: 0, max: 50 })
})

test('ignores values cached for a different board', () => {
  expect(boardConfigPrefill(cached, 'board-2')).toBeNull()
})

test('has no prefill without cached values or a selected board', () => {
  expect(boardConfigPrefill(null, 'board-1')).toBeNull()
  expect(boardConfigPrefill(cached, null)).toBeNull()
  expect(boardConfigPrefill({ ...cached, values: {} }, 'board-1')).toBeNull()
})
