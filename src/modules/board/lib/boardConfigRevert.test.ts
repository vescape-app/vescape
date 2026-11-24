import { describe, expect, mock, test } from 'bun:test'
import type { BoardConfigRevertPlan, BoardConfigValues } from 'vescape-core'

import {
  applyPlannedBoardConfigRevert,
  resolveRevertReviewState,
} from '@/modules/board/lib/boardConfigRevert'

const updatedSnapshot: BoardConfigValues = {
  boardId: 'board-1',
  freshness: 'fresh',
  capturedAtMs: 1_700_000_000_000,
  schemaHash: 'hash-a',
  refloatBaseVersion: '1.3.0',
  values: { kp: 20 },
  schema: null,
}

function makePlan(overrides: Partial<BoardConfigRevertPlan> = {}): BoardConfigRevertPlan {
  return {
    boardId: 'board-1',
    targetRevisionId: 42,
    targetCreatedAtMs: 1_700_000_000_000,
    targetRefloatVersion: '1.3.0',
    targetSchemaHash: 'hash-a',
    currentSchemaHash: 'hash-a',
    sameSchema: true,
    changes: { kp: 20 },
    skippedFields: [],
    ...overrides,
  }
}

describe('boardConfigRevert', () => {
  test('resolveRevertReviewState disables confirm for skipped-only plans and board mismatches', () => {
    const skippedOnly = resolveRevertReviewState({
      plan: makePlan({
        changes: {},
        skippedFields: [{ fieldId: 'old_field', label: 'Old field', reason: 'Removed' }],
      }),
      selectedBoardId: 'board-1',
      connectedBoardId: 'board-1',
      canRevert: true,
      applyError: null,
    })
    expect(skippedOnly.visible).toBe(true)
    expect(skippedOnly.confirmDisabled).toBe(true)

    const wrongBoard = resolveRevertReviewState({
      plan: makePlan({ boardId: 'board-1' }),
      selectedBoardId: 'board-2',
      connectedBoardId: 'board-2',
      canRevert: true,
      applyError: null,
    })
    expect(wrongBoard.confirmDisabled).toBe(true)

    const ready = resolveRevertReviewState({
      plan: makePlan({ boardId: 'board-1' }),
      selectedBoardId: 'board-1',
      connectedBoardId: 'board-1',
      canRevert: true,
      applyError: null,
    })
    expect(ready.confirmDisabled).toBe(false)
  })

  test('applyPlannedBoardConfigRevert binds to plan.boardId and passes expectedSchemaHash', async () => {
    const applyChangeset = mock(async () => updatedSnapshot)
    const outcome = await applyPlannedBoardConfigRevert({
      plan: makePlan({ boardId: 'board-1', currentSchemaHash: 'hash-a', changes: { kp: 20 } }),
      canRevert: true,
      connectedBoardId: 'board-1',
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })

    expect(outcome).toEqual({ kind: 'applied', boardId: 'board-1', updated: updatedSnapshot })
    expect(applyChangeset).toHaveBeenCalledWith('board-1', { kp: 20 }, 'revert', 'hash-a')
  })

  test('applyPlannedBoardConfigRevert refuses when connected board or schema changed', async () => {
    const applyChangeset = mock(async () => updatedSnapshot)

    const wrongBoard = await applyPlannedBoardConfigRevert({
      plan: makePlan({ boardId: 'board-1' }),
      canRevert: true,
      connectedBoardId: 'board-2',
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })
    expect(wrongBoard.kind).toBe('error')
    expect(applyChangeset).not.toHaveBeenCalled()

    const changedSchema = await applyPlannedBoardConfigRevert({
      plan: makePlan({ currentSchemaHash: 'hash-a' }),
      canRevert: true,
      connectedBoardId: 'board-1',
      currentSchemaHash: 'hash-b',
      applyChangeset,
    })
    expect(changedSchema.kind).toBe('error')
    expect(applyChangeset).not.toHaveBeenCalled()
  })

  test('applyPlannedBoardConfigRevert refuses when board config changed since plan', async () => {
    const applyChangeset = mock(async () => updatedSnapshot)
    const outcome = await applyPlannedBoardConfigRevert({
      plan: makePlan({ currentSchemaHash: 'hash-a' }),
      canRevert: true,
      connectedBoardId: 'board-1',
      currentSchemaHash: 'hash-a',
      plannedCapturedAtMs: 1_700_000_000_000,
      currentCapturedAtMs: 1_700_000_005_000,
      applyChangeset,
    })
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain('Board config changed')
    }
    expect(applyChangeset).not.toHaveBeenCalled()
  })

  test('applyPlannedBoardConfigRevert maps CONFIG_SCHEMA_MISMATCH to a clear message', async () => {
    const applyChangeset = mock(async () => {
      throw Object.assign(new Error('raw mismatch'), { code: 'CONFIG_SCHEMA_MISMATCH' })
    })
    const outcome = await applyPlannedBoardConfigRevert({
      plan: makePlan(),
      canRevert: true,
      connectedBoardId: 'board-1',
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain('firmware schema changed')
    }
  })
})
