import type { BoardConfigXmlImportPlan } from 'vescape-core'

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
