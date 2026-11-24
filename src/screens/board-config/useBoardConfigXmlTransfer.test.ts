import { describe, expect, mock, test } from 'bun:test'
import type { BoardConfigValues, BoardConfigXmlImportPlan } from 'vescape-core'

import {
  applyReviewedBoardConfigChangeset,
  buildExportXmlFilename,
  resolveReviewModalState,
  validateBoardConfigImportSchema,
} from '@/screens/board-config/boardConfigXmlHelpers'

const updatedSnapshot: BoardConfigValues = {
  boardId: 'board-1',
  freshness: 'fresh',
  capturedAtMs: 1_700_000_000_000,
  schemaHash: 'hash-a',
  refloatBaseVersion: '1.3.0',
  values: { kp: 30 },
  schema: null,
}

describe('useBoardConfigXmlTransfer helpers', () => {
  test('buildExportXmlFilename normalizes board names', () => {
    expect(buildExportXmlFilename('My XR+ Board!')).toBe('my-xr-board-refloat-config.xml')
    expect(buildExportXmlFilename('   ')).toBe('board-refloat-config.xml')
    expect(buildExportXmlFilename(undefined)).toBe('board-refloat-config.xml')
  })

  test('resolveReviewModalState disables confirm when import has no writable changes', () => {
    const state = resolveReviewModalState({
      reviewOpen: false,
      hasImportPlan: true,
      canEdit: true,
      applyError: null,
      reviewEntries: [{ id: 'kp' }],
      importReviewEntries: [],
    })
    expect(state.visible).toBe(true)
    expect(state.source).toBe('import')
    expect(state.entries).toEqual([])
    expect(state.confirmDisabled).toBe(true)
    expect(state.error).toBeNull()
  })

  test('resolveReviewModalState enables confirm when editable and entries exist', () => {
    const state = resolveReviewModalState({
      reviewOpen: false,
      hasImportPlan: true,
      canEdit: true,
      applyError: null,
      reviewEntries: [],
      importReviewEntries: [{ id: 'kp' }],
    })
    expect(state.confirmDisabled).toBe(false)
  })

  test('validateBoardConfigImportSchema rejects when active schema hash changed', () => {
    const plan: BoardConfigXmlImportPlan = {
      boardId: 'board-1',
      configVersion: 4,
      currentSchemaHash: 'hash-a',
      changes: { kp: 30 },
      skippedFields: [],
    }
    expect(validateBoardConfigImportSchema(plan, 'hash-a')).toBeNull()
    expect(validateBoardConfigImportSchema(plan, 'hash-b')).toContain('schema changed')
    expect(validateBoardConfigImportSchema(plan, null)).toBeNull()
  })

  test('applyReviewedBoardConfigChangeset passes expectedSchemaHash for app edits and imports', async () => {
    const applyChangeset = mock(async () => updatedSnapshot)

    const appOutcome = await applyReviewedBoardConfigChangeset({
      boardId: 'board-1',
      canEdit: true,
      importPlan: null,
      pendingChanges: { kp: 30 },
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })
    expect(appOutcome.kind).toBe('applied')
    expect(applyChangeset).toHaveBeenCalledWith('board-1', { kp: 30 }, 'app', 'hash-a')

    applyChangeset.mockClear()
    const importPlan: BoardConfigXmlImportPlan = {
      boardId: 'board-1',
      configVersion: 4,
      currentSchemaHash: 'hash-import',
      changes: { kp: 32 },
      skippedFields: [],
    }
    const importOutcome = await applyReviewedBoardConfigChangeset({
      boardId: 'board-1',
      canEdit: true,
      importPlan,
      pendingChanges: {},
      currentSchemaHash: 'hash-import',
      applyChangeset,
    })
    expect(importOutcome.kind).toBe('applied')
    expect(applyChangeset).toHaveBeenCalledWith('board-1', { kp: 32 }, 'import', 'hash-import')
  })

  test('applyReviewedBoardConfigChangeset rejects board switch and maps CONFIG_SCHEMA_MISMATCH', async () => {
    const applyChangeset = mock(async () => {
      throw Object.assign(new Error('mismatch'), { code: 'CONFIG_SCHEMA_MISMATCH' })
    })
    const importPlan: BoardConfigXmlImportPlan = {
      boardId: 'board-1',
      configVersion: 4,
      currentSchemaHash: 'hash-a',
      changes: { kp: 30 },
      skippedFields: [],
    }

    const switchedBoard = await applyReviewedBoardConfigChangeset({
      boardId: 'board-2',
      canEdit: true,
      importPlan,
      pendingChanges: {},
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })
    expect(switchedBoard.kind).toBe('error')
    expect(applyChangeset).not.toHaveBeenCalled()

    const mismatch = await applyReviewedBoardConfigChangeset({
      boardId: 'board-1',
      canEdit: true,
      importPlan: null,
      pendingChanges: { kp: 30 },
      currentSchemaHash: 'hash-a',
      applyChangeset,
    })
    expect(mismatch.kind).toBe('error')
    if (mismatch.kind === 'error') {
      expect(mismatch.message).toContain('firmware schema changed')
    }
  })
})
