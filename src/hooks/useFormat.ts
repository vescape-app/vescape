import { useCallback, useMemo } from 'react'
import { formatSpeedKmh, formatSpeedValue, speedUnit, formatDistanceMeters } from '@/helpers/units'
import { useUnitSystem } from '@/hooks/useUnitSystem'

/** Speed inputs are canonical km/h. Precision is a maximum; trailing zeros are omitted. */
export function useFormat() {
  const units = useUnitSystem()
  const formatSpeed = useCallback(
    (kmh: number, precision = 0): string => {
      'worklet'
      return formatSpeedValue(kmh, units, precision)
    },
    [units],
  )
  const formatSpeedWithUnit = useCallback(
    (kmh: number, precision = 0): string => {
      'worklet'
      return formatSpeedKmh(kmh, units, precision)
    },
    [units],
  )
  const formatDistance = useCallback(
    (meters: number) => formatDistanceMeters(meters, units),
    [units],
  )
  return useMemo(
    () => ({ formatSpeed, formatSpeedWithUnit, formatDistance, speedUnit: speedUnit(units) }),
    [formatSpeed, formatSpeedWithUnit, formatDistance, units],
  )
}
