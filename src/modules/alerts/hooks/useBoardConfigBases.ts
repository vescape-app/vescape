import { useMemo } from 'react'

import { boardConfigBases } from '@/modules/alerts/lib/boardConfigBases'
import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Both of the board's configs, live. Used for preview — what the rider sees a matched preset
 * resolve to right now. Native re-resolves the same relationships from its own copy when the
 * alerts actually fire.
 */
export function useBoardConfigBases(): BoardConfigBases {
  const refloatValues = useBoardConfigValuesStore((s) => s.values?.values)
  const motor = useMotorConfigFields()

  return useMemo(() => boardConfigBases(refloatValues, motor?.values), [refloatValues, motor])
}
