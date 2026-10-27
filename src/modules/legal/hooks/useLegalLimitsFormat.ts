import { useCallback, useMemo } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { legalLimitLabelShape, legalReferenceSpeedLabel } from '@/modules/legal/lib/legalLimits'

/** Bind Legal Limits speed labels to the rider's current display units. */
export function useLegalReferenceSpeedFormat() {
  const distanceUnit = useDistanceUnit()
  return useCallback(
    (kmh: number | null) => legalReferenceSpeedLabel(kmh, distanceUnit),
    [distanceUnit],
  )
}

/** Rebuild Legal Limits map labels when the rider changes display units. */
export function useLegalLimitLabelShape() {
  const distanceUnit = useDistanceUnit()
  const labelShape = useMemo(() => legalLimitLabelShape(distanceUnit), [distanceUnit])
  return labelShape
}
