import { useCallback, useMemo } from 'react'
import {
  formatDistanceMeters,
  formatSpeedKmh,
  formatSpeedValue,
  formatTemperatureC,
  formatTemperatureValue,
  speedUnit,
  temperatureSymbol,
} from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'

export function useFormat() {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
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
  const formatTemperature = useCallback(
    (celsius: number, precision = 0): string => {
      'worklet'
      return formatTemperatureValue(celsius, temperatureUnit, precision)
    },
    [temperatureUnit],
  )
  const formatTemperatureWithUnit = useCallback(
    (celsius: number, precision = 0): string => {
      'worklet'
      return formatTemperatureC(celsius, temperatureUnit, precision)
    },
    [temperatureUnit],
  )
  return useMemo(
    () => ({
      formatSpeed,
      formatSpeedWithUnit,
      formatDistance,
      speedUnit: speedUnit(distanceUnit),
      formatTemperature,
      formatTemperatureWithUnit,
      temperatureUnit: temperatureSymbol(temperatureUnit),
    }),
    [
      formatSpeed,
      formatSpeedWithUnit,
      formatDistance,
      distanceUnit,
      formatTemperature,
      formatTemperatureWithUnit,
      temperatureUnit,
    ],
  )
}
