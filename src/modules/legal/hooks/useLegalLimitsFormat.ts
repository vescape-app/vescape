import { useCallback, useMemo } from 'react'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import { legalLimitLabelShape, legalReferenceSpeedLabel } from '@/modules/legal/lib/legalLimits'

/** Bind Legal Limits speed labels to the rider's current display units. */
export function useLegalReferenceSpeedFormat() {
  const units = useUnitSystem()
  return useCallback((kmh: number | null) => legalReferenceSpeedLabel(kmh, units), [units])
}

/** Rebuild Legal Limits map labels when the rider changes display units. */
export function useLegalLimitLabelShape() {
  const units = useUnitSystem()
  const labelShape = useMemo(() => legalLimitLabelShape(units), [units])
  return labelShape
}
