import {
  applyBoardConfigChangeset,
  type BoardConfigValues,
  type BoardConfigXmlImportPlan,
} from 'vescape-core'

import { boardConfigErrorMessage } from '@/modules/board/lib/boardConfigErrors'

export function buildExportXmlFilename(boardName: string | undefined): string {
  const slug = (boardName ?? 'board')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'board'}-refloat-config.xml`
}

export function resolveReviewModalState<TEntry>(params: {
  reviewOpen: boolean
  hasImportPlan: boolean
  canEdit: boolean
  applyError: string | null
  reviewEntries: TEntry[]
  importReviewEntries: TEntry[]
}) {
  const visible = params.reviewOpen || params.hasImportPlan
  const entries = params.hasImportPlan ? params.importReviewEntries : params.reviewEntries
  return {
    visible,
    source: params.hasImportPlan ? ('import' as const) : ('app' as const),
    entries,
    confirmDisabled: !params.canEdit || entries.length === 0,
    error:
      params.applyError ??
      (!params.canEdit && visible ? 'Board disconnected. Reconnect to apply changes.' : null),
  }
}

export function validateBoardConfigImportSchema(
  plan: BoardConfigXmlImportPlan,
  currentSchemaHash: string | null | undefined,
): string | null {
  if (currentSchemaHash && plan.currentSchemaHash !== currentSchemaHash) {
    return 'Board firmware schema changed since this XML was planned. Pick the file again to re-plan.'
  }
  return null
}

export async function applyReviewedBoardConfigChangeset(params: {
  boardId: string | undefined
  canEdit: boolean
  importPlan: BoardConfigXmlImportPlan | null
  pendingChanges: Record<string, number | boolean>
  currentSchemaHash: string | null | undefined
  applyChangeset?: typeof applyBoardConfigChangeset
}): Promise<
  | { kind: 'noop' }
  | { kind: 'error'; message: string }
  | { kind: 'applied'; isImport: boolean; updated: BoardConfigValues }
> {
  const { importPlan } = params
  const applyChangeset = params.applyChangeset ?? applyBoardConfigChangeset
  const targetBoardId = importPlan !== null ? importPlan.boardId : params.boardId
  const targetChanges = importPlan !== null ? importPlan.changes : params.pendingChanges
  if (!targetBoardId || Object.keys(targetChanges).length === 0) {
    return { kind: 'noop' }
  }
  if (importPlan !== null && params.boardId && importPlan.boardId !== params.boardId) {
    return {
      kind: 'error',
      message: 'Selected board changed since this XML was planned. Pick the file again to re-plan.',
    }
  }
  if (!params.canEdit) {
    return { kind: 'error', message: 'Board disconnected. Reconnect to apply changes.' }
  }
  if (importPlan !== null) {
    const schemaError = validateBoardConfigImportSchema(importPlan, params.currentSchemaHash)
    if (schemaError) return { kind: 'error', message: schemaError }
  }
  try {
    const updated =
      importPlan !== null
        ? await applyChangeset(targetBoardId, targetChanges, 'import', importPlan.currentSchemaHash)
        : await applyChangeset(
            targetBoardId,
            targetChanges,
            'app',
            params.currentSchemaHash ?? null,
          )
    return { kind: 'applied', isImport: importPlan !== null, updated }
  } catch (err) {
    return {
      kind: 'error',
      message: boardConfigErrorMessage(err, 'Board configuration could not be written.'),
    }
  }
}
