import type { BoardConfigValues, RefloatConfigGroup, TuneProfileFieldValue } from 'vescape-core'

import { APP_TUNE_GROUPS } from '@/modules/tune/lib/fields'
import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'

/**
 * The board-side field set the Tune screen renders and diffs against: either the fresh Tune Snapshot
 * read in this Board Session, or the provisional prefill built from cached Board Config Values.
 *
 * Both are read-only board values in the domain sense. Only the fresh one may ever back a write —
 * that gate lives on the write path, not here (ADR 0035).
 */
export interface TuneBoardValues {
  groups: RefloatConfigGroup[]
  refloatBaseVersion?: string | null
}

/** Curated app tune groups filled from a flat field map, dropping fields the map has no value for. */
export function groupsFromFieldValues(
  fields: Record<string, TuneProfileFieldValue> | null,
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

/**
 * Provisional board values for the Tune screen, from the cached Board Config Values mirror, so the
 * screen renders numbers instead of a spinner while the session read is still on the wire.
 *
 * Native already scopes the cache per Board and Refloat base version and clears it on `mismatched`
 * (ADR 0022, ADR 0035); the board check here only covers the window where the mirror still holds
 * the previously selected Board.
 */
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
