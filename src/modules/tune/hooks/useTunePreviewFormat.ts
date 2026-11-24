import { useCallback, useMemo } from 'react'
import { formatLengthMeters } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { hillsOptions, movementOptions } from '@/modules/tune/lib/tunePreviewPresentation'

export function useTunePreviewFormat() {
  const { distanceUnit } = useUserPreferences()
  const options = useMemo(
    () => ({ hills: hillsOptions(distanceUnit), movement: movementOptions(distanceUnit) }),
    [distanceUnit],
  )
  const formatHillHeight = useCallback(
    (meters: number) => formatLengthMeters(meters, distanceUnit, 1),
    [distanceUnit],
  )
  const formatHillSpacing = useCallback(
    (meters: number) => formatLengthMeters(meters, distanceUnit, distanceUnit === 'mi' ? 1 : 0),
    [distanceUnit],
  )
  return { options, formatHillHeight, formatHillSpacing }
}
