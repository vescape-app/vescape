import type { BoardConfigFieldValues } from 'vescape-core'

import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'

/** Shape Board configuration for resolving saved alert relationships and draft previews. */
export function boardConfigBases(
  refloat: BoardConfigFieldValues | undefined,
  motor: Record<string, number> | undefined,
): BoardConfigBases {
  return { refloat: numbersOnly(refloat), motor: motor ?? null }
}

/** Refloat carries booleans too; a config-relative anchor is only ever a number. */
function numbersOnly(values: BoardConfigFieldValues | undefined): Record<string, number> | null {
  if (!values) return null
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>
}
