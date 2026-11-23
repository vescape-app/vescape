import { useCallback, useMemo } from 'react'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { legalLimitLabelShape, legalReferenceSpeedLabel } from '@/modules/legal/lib/legalLimits'

export function useLegalReferenceSpeedFormat() {
  const { distanceUnit } = useUserPreferences()
  return useCallback(
    (kmh: number | null) => legalReferenceSpeedLabel(kmh, distanceUnit),
    [distanceUnit],
  )
}

export function useLegalLimitLabelShape() {
  const { distanceUnit } = useUserPreferences()
  const labelShape = useMemo(() => legalLimitLabelShape(distanceUnit), [distanceUnit])
  return labelShape
}
