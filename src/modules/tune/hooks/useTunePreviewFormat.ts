import { useCallback, useMemo } from 'react'
import { formatLengthMeters } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { hillsOptions, movementOptions } from '@/modules/tune/lib/tunePreviewPresentation'

/** Bind Tune Preview preset labels and read-only dimensions to current display units. */
export function useTunePreviewFormat() {
  const distanceUnit = useDistanceUnit()
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
