import type { BoardConfigSchema, BoardConfigValues, TuneProfileFieldValue } from 'vescape-core'

import {
  deriveFallbackGroupsFromValues,
  deriveTuneGroupsFromSchema,
  type ResolvedBoardConfigGroup,
} from '@/modules/board/lib/refloatFieldOverlay'

export interface TuneBoardValues {
  groups: ResolvedBoardConfigGroup[]
  refloatBaseVersion?: string | null
}

export function groupsFromFieldValues(
  fields: Record<string, TuneProfileFieldValue | undefined> | null,
  schema?: BoardConfigSchema | null,
): ResolvedBoardConfigGroup[] {
  if (!fields) return []
  if (schema && schema.groups.length > 0) {
    return deriveTuneGroupsFromSchema(schema, fields)
  }
  return deriveFallbackGroupsFromValues(fields)
}

export function boardConfigPrefill(
  values: BoardConfigValues | null,
  selectedBoardId: string | null,
): TuneBoardValues | null {
  if (!values || !selectedBoardId) return null
  if (values.boardId != null && values.boardId !== selectedBoardId) return null
  const groups = groupsFromFieldValues(values.values, values.schema)
  if (groups.length === 0) return null
  return { groups, refloatBaseVersion: values.refloatBaseVersion }
}
