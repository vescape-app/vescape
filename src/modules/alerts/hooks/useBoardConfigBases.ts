import { useMemo } from 'react'

import { boardConfigBases } from '@/modules/alerts/lib/boardConfigBases'
import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useBoardConfigFields } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Both of the board's configs — live session values, or the Last Known copy while the Board is
 * off, the same source the config readouts show. Used for preview — what the rider sees a matched preset
 * resolve to right now. Native re-resolves the same relationships from its own copy when the
 * alerts actually fire.
 */
export function useBoardConfigBases(): BoardConfigBases {
  const refloat = useBoardConfigFields()
  const motor = useMotorConfigFields()

  return useMemo(() => boardConfigBases(refloat?.values, motor?.values), [refloat, motor])
}
