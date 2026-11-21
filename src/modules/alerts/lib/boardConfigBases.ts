import type { BoardConfigFieldValues } from 'vescape-core'

import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'

export function boardConfigBases(
  refloat: BoardConfigFieldValues | undefined,
  motor: Record<string, number> | undefined,
): BoardConfigBases {
  return { refloat: numbersOnly(refloat), motor: motor ?? null }
}

function numbersOnly(values: BoardConfigFieldValues | undefined): Record<string, number> | null {
  if (!values) return null
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>
}
