import { useCallback, useMemo } from 'react'
import { formatLengthMeters } from '@/helpers/units'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import { hillsOptions, movementOptions } from '@/modules/tune/lib/tunePreviewPresentation'

/** Bind Tune Preview preset labels and read-only dimensions to current display units. */
export function useTunePreviewFormat() {
  const units = useUnitSystem()
  const options = useMemo(
    () => ({ hills: hillsOptions(units), movement: movementOptions(units) }),
    [units],
  )
  const formatHillHeight = useCallback(
    (meters: number) => formatLengthMeters(meters, units, 1),
    [units],
  )
  const formatHillSpacing = useCallback(
    (meters: number) => formatLengthMeters(meters, units, units === 'imperial' ? 1 : 0),
    [units],
  )
  return { options, formatHillHeight, formatHillSpacing }
}
