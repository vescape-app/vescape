import { useMemo } from 'react'

import { boardConfigBases } from '@/modules/alerts/lib/boardConfigBases'
import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useBoardConfigFields } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

export function useBoardConfigBases(): BoardConfigBases {
  const refloat = useBoardConfigFields()
  const motor = useMotorConfigFields()

  return useMemo(() => boardConfigBases(refloat?.values, motor?.values), [refloat, motor])
}
