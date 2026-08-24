import { useMemo } from 'react'

import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Both of the board's configs as the Alert Preset generator wants them: numeric fields only, keyed
 * by config. Used for preview — what the rider sees a matched preset resolve to right now. Native
 * re-resolves the same relationships from its own copy when the alerts actually fire.
 */
export function useBoardConfigBases(): BoardConfigBases {
  const refloatValues = useBoardConfigValuesStore((s) => s.values?.values)
  const motor = useMotorConfigFields()

  return useMemo(
    () => ({ refloat: numbersOnly(refloatValues), motor: motor?.values ?? null }),
    [refloatValues, motor],
  )
}

/** Refloat carries booleans too; a config-relative anchor is only ever a number. */
function numbersOnly(
  values: Record<string, number | boolean> | undefined,
): Record<string, number> | null {
  if (!values) return null
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>
}
