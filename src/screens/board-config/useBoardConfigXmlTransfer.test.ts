import { describe, expect, test } from 'bun:test'
import type { BoardConfigXmlImportPlan } from 'vescape-core'

import {
  buildExportXmlFilename,
  resolveReviewModalState,
  validateBoardConfigImportSchema,
} from '@/screens/board-config/boardConfigXmlHelpers'

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
})
