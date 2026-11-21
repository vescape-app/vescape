import { useCallback, useMemo } from 'react'
import { formatSpeedKmh, formatSpeedValue, speedUnit, formatDistanceMeters } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'

export function useFormat() {
  const distanceUnit = useDistanceUnit()
  const formatSpeed = useCallback(
    (kmh: number, precision = 0): string => {
      'worklet'
      return formatSpeedValue(kmh, distanceUnit, precision)
    },
    [distanceUnit],
  )
  const formatSpeedWithUnit = useCallback(
    (kmh: number, precision = 0): string => {
      'worklet'
      return formatSpeedKmh(kmh, distanceUnit, precision)
    },
    [distanceUnit],
  )
  const formatDistance = useCallback(
    (meters: number) => formatDistanceMeters(meters, distanceUnit),
    [distanceUnit],
  )
  return useMemo(
    () => ({
      formatSpeed,
      formatSpeedWithUnit,
      formatDistance,
      speedUnit: speedUnit(distanceUnit),
    }),
    [formatSpeed, formatSpeedWithUnit, formatDistance, distanceUnit],
  )
}
