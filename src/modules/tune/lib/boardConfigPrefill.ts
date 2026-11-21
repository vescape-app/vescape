import type { BoardConfigValues, RefloatConfigGroup, TuneProfileFieldValue } from 'vescape-core'

import { APP_TUNE_GROUPS } from '@/modules/tune/lib/fields'
import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'

export interface TuneBoardValues {
  groups: RefloatConfigGroup[]
  refloatBaseVersion?: string | null
}

export function groupsFromFieldValues(
  fields: Record<string, TuneProfileFieldValue | undefined> | null,
): RefloatConfigGroup[] {
  if (!fields) return []
  return APP_TUNE_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    fields: group.fields.flatMap((field) => {
      const value = fields[field.id]
      if (!isDisplayableFieldValue(value)) return []
      return [
        {
          id: field.id,
          label: field.label,
          value,
          unit: field.unit,
          min: field.min,
          max: field.max,
        },
      ]
    }),
  })).filter((group) => group.fields.length > 0)
}

export function boardConfigPrefill(
  values: BoardConfigValues | null,
  selectedBoardId: string | null,
): TuneBoardValues | null {
  if (!values || !selectedBoardId) return null
  if (values.boardId != null && values.boardId !== selectedBoardId) return null
  const groups = groupsFromFieldValues(values.values)
  if (groups.length === 0) return null
  return { groups, refloatBaseVersion: values.refloatBaseVersion }
}
