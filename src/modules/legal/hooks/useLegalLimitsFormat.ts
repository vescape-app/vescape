import { useCallback, useMemo } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { legalLimitLabelShape, legalReferenceSpeedLabel } from '@/modules/legal/lib/legalLimits'

export function useLegalReferenceSpeedFormat() {
  const distanceUnit = useDistanceUnit()
  return useCallback(
    (kmh: number | null) => legalReferenceSpeedLabel(kmh, distanceUnit),
    [distanceUnit],
  )
}

export function useLegalLimitLabelShape() {
  const distanceUnit = useDistanceUnit()
  const labelShape = useMemo(() => legalLimitLabelShape(distanceUnit), [distanceUnit])
  return labelShape
}
